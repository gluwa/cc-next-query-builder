use alloy::{
    primitives::B256,
    providers::{Provider, ProviderBuilder, WsConnect},
    rpc::types::TransactionReceipt,
};

use anyhow::{anyhow, Result};
use clap::Parser;

use std::fs;
use std::str::FromStr;

use usc_abi_encoding::abi::abi_encode;
use usc_abi_encoding::common::EncodingVersion;

/// The 8 largest transactions ever observed successfully-encoded on Ethereum
/// Mainnet. The streaming `encode-blocks` binary only re-encountered blocks of
/// this size non-deterministically on the live head; this binary instead
/// queries these exact block/tx pairs directly so they are encoded (and decoded
/// downstream) on every CI run. Mainnet-only: Sepolia is intentionally
/// unsupported here.
const LARGEST_MAINNET_TXNS: &[(u64, &str)] = &[
    (
        25602727,
        "0x4e94d836e6e2794556e1cbb3a2cfb1945248d156c97b5d902835dbd9a4b88e60",
    ),
    (
        25599245,
        "0x24a6129734163346da53f056a8022f3ec37d70b8350ed9b8300620bbbdba6e1e",
    ),
    (
        25551628,
        "0x181611bff5f83dcf85cc45e06a453ee79a4ca1a697a1316030e655901c71bee8",
    ),
    (
        25551622,
        "0x296d83e8a0db263ad06422be8c6bd426c70785cc7c4f2b0b559eec5586e9da86",
    ),
    (
        25238768,
        "0x01ca130bf04e636d26ebdf0f6256a99894a6b474d4c016af74849c6a7572928d",
    ),
    (
        25238750,
        "0x343b91c47944693ed1cdf3c979bd7722ed9284320ff6069bcfd46c109d9c4199",
    ),
    (
        25238749,
        "0x5f60979ee18aba3f76122574e987f974fb1d7bacc372666f4b3f647236d54794",
    ),
    (
        25238746,
        "0xf2641f3bd13a111169c007205b3d1e7188201df3ae041991d2e1e3745ed1fb2d",
    ),
];

#[derive(Parser, Debug)]
#[command(name = "encode-largest-txns")]
pub struct CliArguments {
    #[arg(long, help = "WebSockets URL to an Ethereum Mainnet RPC", required = true)]
    pub eth_rpc_url: String,

    #[arg(long, help = "Directory path to store JSON files", required = true)]
    pub path_to_store_json: String,
}

async fn encode_transaction(
    provider: impl Provider,
    tx_hash_str: &str,
    rx_or_none: Option<TransactionReceipt>,
) -> Result<String> {
    let tx_hash = B256::from_str(tx_hash_str)?;

    let tx = provider
        .get_transaction_by_hash(tx_hash)
        .await?
        .ok_or_else(|| anyhow!("transaction {tx_hash_str} not found via RPC"))?;

    let rx = match rx_or_none {
        Some(rx) => rx,
        None => provider
            .get_transaction_receipt(tx_hash)
            .await?
            .ok_or_else(|| anyhow!("receipt for {tx_hash_str} not found via RPC"))?,
    };

    let encoded_data = abi_encode(tx, rx, EncodingVersion::V1)
        .ok_or_else(|| anyhow!("abi_encode returned None for {tx_hash_str}"))?;
    let as_str = hex::encode(encoded_data.abi());

    Ok(format!("0x{as_str}"))
}

async fn encode_and_write_to_disk(
    path: &str,
    provider: impl Provider,
    block_number: u64,
    tx_hash: &str,
) -> Result<()> {
    let encoded_data = encode_transaction(provider, tx_hash, None).await?;

    // <path>/<block_num>/<tx_hash>.txt
    fs::create_dir_all(format!("{path}/{block_number}"))?;
    fs::write(format!("{path}/{block_number}/{tx_hash}.txt"), encoded_data + "\n")?;

    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = CliArguments::parse();

    println!(
        "=== encoding {} largest mainnet transactions ...",
        LARGEST_MAINNET_TXNS.len()
    );

    fs::create_dir_all(args.path_to_store_json.clone())?;

    let provider = ProviderBuilder::new()
        .on_ws(WsConnect::new(args.eth_rpc_url))
        .await?;

    // Encode each documented transaction directly by hash. We fail the whole
    // run on any error: unlike the streaming encoder (which skips transient
    // failures on live blocks), these are fixed historical fixtures and must
    // always be retrievable/encodable.
    for (block_number, tx_hash) in LARGEST_MAINNET_TXNS {
        println!("--- encoding block {block_number} txn {tx_hash}");
        encode_and_write_to_disk(
            &args.path_to_store_json,
            provider.clone(),
            *block_number,
            tx_hash,
        )
        .await?;
    }

    println!(
        "<<< done encoding {} transactions",
        LARGEST_MAINNET_TXNS.len()
    );

    Ok(())
}
