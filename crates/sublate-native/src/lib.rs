//! napi-rs 导出层：只做薄封装，重逻辑放在 `sublate-core` 或后续 crate。

use napi::bindgen_prelude::*;
use napi_derive::napi;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};

/// 计算文件 SHA-256，流式读取，避免整文件载入内存。
#[napi]
pub fn file_sha256(path: String) -> Result<String> {
    let file = File::open(&path)
        .map_err(|error| Error::from_reason(format!("打开文件失败：{error}")))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| Error::from_reason(format!("读取文件失败：{error}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// 返回原生模块版本，用于启动自检。
#[napi]
pub fn native_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
