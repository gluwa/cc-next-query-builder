use alloy::{
    eips::BlockNumberOrTag,
    primitives::B256,
    providers::{Provider, ProviderBuilder, WsConnect},
    rpc::types::{BlockTransactionsKind, TransactionReceipt},
};

use anyhow::Result;
use clap::Parser;
use futures_util::StreamExt;
use hex;

use std::env;
use std::fs;
use std::str::FromStr;
use std::time::SystemTime;

use usc_abi_encoding::abi::abi_encode;
use usc_abi_encoding::common::EncodingVersion;

#[derive(Parser, Debug)]
#[command(name = "encode-blocks")]
pub struct CliArguments {
    #[arg(long, help = "WebSockets URL to an Ethereum RPC", required = true)]
    pub eth_rpc_url: String,

    #[arg(long, help = "Directory path to store JSON files", required = true)]
    pub path_to_store_json: String,
}

async fn encode_transaction(
    provider: impl Provider,
    tx_hash_str: &str,
    rx_or_none: Option<TransactionReceipt>,
) -> String {
    let tx_hash = B256::from_str(tx_hash_str).unwrap();

    let tx = provider
        .get_transaction_by_hash(tx_hash)
        .await
        .unwrap()
        .unwrap();

    let mut rx = rx_or_none.clone();
    if rx_or_none.is_none() {
        rx = provider.get_transaction_receipt(tx_hash).await.unwrap();
    }

    let encoded_data = abi_encode(tx, rx.expect("receipt missing"), EncodingVersion::V1).unwrap();
    let as_str = hex::encode(encoded_data.abi());

    format!("0x{}", as_str)
}

async fn encode_and_write_to_disk(
    path: String,
    provider: impl Provider,
    block_number: u64,
    tx_hash: String,
    rx_or_none: Option<TransactionReceipt>,
) {
    let encoded_data = encode_transaction(provider, &tx_hash.to_string(), rx_or_none).await;

    // <path>/<block_num>/<tx_hash>.txt
    fs::write(
        format!("{}/{}/{}.txt", path, block_number, tx_hash.to_string()),
        encoded_data + "\n",
    )
    .unwrap();
}

async fn block_handler(
    provider: impl Provider + Clone + 'static,
    block_number: u64,
    path_to_store_json: String,
) -> Result<()> {
    println!("new finalized --- {:?}", block_number);

    fs::create_dir_all(format!("{}/{}", path_to_store_json, block_number))?;

    let block = provider
        .get_block_by_number(block_number.into(), BlockTransactionsKind::Full)
        .await?
        .unwrap();

    let tx_hashes = block.transactions.hashes();

    if tx_hashes.len() >= 13 {
        // optimize RPC cost by fetching all receipts at once
        let receipts = provider
            .get_block_receipts(block_number.into())
            .await?
            .unwrap();
        let tasks: Vec<_> = receipts
            .into_iter()
            .map(|rcp| {
                tokio::spawn({
                    let prv = provider.clone();
                    let path = path_to_store_json.clone();
                    async move {
                        encode_and_write_to_disk(
                            path.clone(),
                            prv.clone(),
                            block_number,
                            rcp.transaction_hash.to_string(),
                            Some(rcp),
                        )
                        .await;
                    }
                })
            })
            .collect();

        for task in tasks {
            task.await.unwrap();
        }
    } else {
        // loop over each transaction and fetch its receipt via explicit RPC call
        let tasks: Vec<_> = tx_hashes
            .clone()
            .into_iter()
            .map(|tx_hash| {
                tokio::spawn({
                    let prv = provider.clone();
                    let path = path_to_store_json.clone();
                    async move {
                        encode_and_write_to_disk(
                            path.clone(),
                            prv.clone(),
                            block_number,
                            tx_hash.to_string(),
                            None,
                        )
                        .await;
                    }
                })
            })
            .collect();

        for task in tasks {
            task.await.unwrap();
        }
    }

    println!(
        "<<< done encoding {:?} transactions in block {:?}",
        tx_hashes.len(),
        block_number
    );

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = CliArguments::parse();

    let start = SystemTime::now();
    let timeout_minutes: u64 = env::var("TIMEOUT_MINUTES").unwrap_or("2".into()).parse()?;
    println!("=== starting with timeout {:?} mins ...", timeout_minutes);

    fs::create_dir_all(args.path_to_store_json.clone())?;

    let provider = ProviderBuilder::new()
        .on_ws(WsConnect::new(args.eth_rpc_url))
        .await?;

    // Listen only to finalized blocks. The standard JSON-RPC pubsub interface
    // does not expose a finalized subscription, so we use the new-head stream
    // purely as a trigger and pull the latest finalized block on each tick,
    // processing any blocks that finalized since the last run.
    let subscriber = provider.subscribe_blocks().await?;
    let mut stream = subscriber.into_stream();
    let mut last_finalized: Option<u64> = None;
    while stream.next().await.is_some() {
        let finalized = provider
            .get_block_by_number(BlockNumberOrTag::Finalized, BlockTransactionsKind::Hashes)
            .await?;
        let Some(finalized) = finalized else {
            continue;
        };
        let finalized_number = finalized.header.number;

        let from = match last_finalized {
            Some(prev) if prev >= finalized_number => {
                // No new finalized blocks since the last tick.
                let current = start.elapsed()?;
                if current.as_secs() >= timeout_minutes * 60 {
                    println!("=== {timeout_minutes:?} mins timeout reached. exiting ...");
                    break;
                }
                continue;
            }
            Some(prev) => prev + 1,
            None => finalized_number,
        };

        for block_number in from..=finalized_number {
            let _ = block_handler(
                provider.clone(),
                block_number,
                args.path_to_store_json.clone(),
            )
            .await;
        }
        last_finalized = Some(finalized_number);

        let current = start.elapsed()?;
        if current.as_secs() >= timeout_minutes * 60 {
            println!("=== {timeout_minutes:?} mins timeout reached. exiting ...");
            break;
        }
    }

    Ok(())
}
