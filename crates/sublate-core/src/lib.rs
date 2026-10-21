//! SublateMaze Rust 核心：平台无关的纯函数与数据结构。
//!
//! 当前为 M0 骨架，后续在此加入文件哈希、分块与 PDF 辅助逻辑。

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// 骨架占位，供工作区编译验证使用。
pub fn crate_name() -> &'static str {
    "sublate-core"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_crate_name() {
        assert_eq!(crate_name(), "sublate-core");
        assert!(!VERSION.is_empty());
    }
}
