use alloy::{
    primitives::B256,
    providers::{Provider, ProviderBuilder, WsConnect},
    rpc::types::BlockTransactionsKind,
};

use anyhow::Result;
use ccnext_abi_encoding::abi::{abi_encode, EncodingVersion};
use clap::Parser;
use futures_util::StreamExt;
use hex;
use std::fs;
use std::str::FromStr;

#[derive(Parser, Debug)]
#[command(name = "encode-blocks")]
pub struct CliArguments {
    #[arg(long, help = "WebSockets URL to an Ethereum RPC", required = true)]
    pub eth_rpc_url: String,

    #[arg(long, help = "Directory path to store JSON files", required = true)]
    pub path_to_store_json: String,
}

async fn encode_transaction(provider: impl Provider, tx_hash_str: &str) -> String {
    let tx_hash = B256::from_str(tx_hash_str).unwrap();

    let tx = provider
        .get_transaction_by_hash(tx_hash)
        .await
        .unwrap()
        .unwrap();

    let rx = provider
        .get_transaction_receipt(tx_hash)
        .await
        .unwrap()
        .unwrap();

    let bytes = abi_encode(tx, rx, EncodingVersion::V1).unwrap().abi;

    let as_str = hex::encode(bytes);
    format!("0x{}", as_str)
}

async fn block_handler(
    provider: impl Provider + Clone + 'static,
    block_number: u64,
    path_to_store_json: String,
) -> Result<()> {
    println!("new block --- {:?}", block_number);

    fs::create_dir_all(format!("{}/{}", path_to_store_json, block_number))?;

    let block = provider
        .get_block_by_number(block_number.into(), BlockTransactionsKind::Full)
        .await?
        .unwrap();

    let tx_hashes = block.transactions.hashes();

    // encode in parallel b/c there could be thousand transactions in a block
    let tasks: Vec<_> = tx_hashes
        .clone()
        .into_iter()
        .map(|tx_hash| {
            tokio::spawn({
                let prv = provider.clone();
                let path = path_to_store_json.clone();
                async move {
                    let encoded_data = encode_transaction(prv.clone(), &tx_hash.to_string()).await;

                    // <path>/<block_num>/<tx_hash>.txt
                    fs::write(
                        format!("{}/{}/{}.txt", path, block_number, tx_hash.to_string()),
                        encoded_data + "\n",
                    )
                    .unwrap();
                }
            })
        })
        .collect();

    // await all tasks to complete
    for task in tasks {
        task.await.unwrap();
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

    fs::create_dir_all(args.path_to_store_json.clone())?;

    let provider = ProviderBuilder::new()
        .on_ws(WsConnect::new(args.eth_rpc_url))
        .await?;

    let subscriber = provider.subscribe_blocks().await?;
    let mut stream = subscriber.into_stream();
    while let Some(block) = stream.next().await {
        let _ = block_handler(
            provider.clone(),
            block.number,
            args.path_to_store_json.clone(),
        )
        .await;
    }

    Ok(())
}
