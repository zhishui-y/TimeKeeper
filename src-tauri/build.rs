use std::{
    env, fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

fn libsodium_platform_dir() -> Option<&'static str> {
    match env::var("CARGO_CFG_TARGET_ARCH").ok()?.as_str() {
        "x86" => Some("Win32"),
        "x86_64" => Some("x64"),
        "aarch64" => Some("ARM64"),
        _ => None,
    }
}

fn newest_libsodium_pdb(profile_dir: &Path, configuration: &str) -> Option<PathBuf> {
    let build_dir = profile_dir.join("build");
    let platform = libsodium_platform_dir()?;
    fs::read_dir(build_dir)
        .ok()?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("libsodium-sys-stable-")
        })
        .map(|entry| {
            entry
                .path()
                .join("out/installed/libsodium")
                .join(platform)
                .join(configuration)
                .join("v143/static/libsodium.pdb")
        })
        .filter(|path: &PathBuf| path.is_file())
        .max_by_key(|path| {
            path.metadata()
                .and_then(|metadata| metadata.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH)
        })
}

fn configure_windows_libsodium_linking() {
    if env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return;
    }

    let debug = env::var("DEBUG").as_deref() == Ok("true");
    let configuration = if debug { "Debug" } else { "Release" };
    let static_crt = if debug { "LIBCMTD" } else { "LIBCMT" };

    // libsodium-sys-stable bundles a /MT(d) static archive while Rust's MSVC
    // target uses the dynamic CRT. Resolve all native CRT references through
    // Rust's selected runtime instead of linking two incompatible CRT copies.
    println!("cargo:rustc-link-arg=/NODEFAULTLIB:{static_crt}");

    // The desktop executable links the Rust rlib directly; no Windows consumer
    // imports the generated cdylib or test binaries. Avoid unused import-library
    // artifacts and link.exe's otherwise harmless "creating library" stdout.
    println!("cargo:rustc-link-arg=/NOIMPLIB");
    println!("cargo:rustc-link-arg=/NOEXP");

    // The dependency archive keeps CodeView records that reference
    // `libsodium.pdb`. rustc repackages its objects into an rlib, so place the
    // matching PDB beside the final link inputs where link.exe searches for it.
    let Some(out_dir) = env::var_os("OUT_DIR").map(PathBuf::from) else {
        return;
    };
    let Some(profile_dir) = out_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
    else {
        return;
    };
    let Some(source) = newest_libsodium_pdb(profile_dir, configuration) else {
        println!("cargo:warning=未找到 libsodium.pdb，原生依赖调试符号将不可用");
        return;
    };
    let destination_dir = profile_dir.join("deps");
    if let Err(error) = fs::create_dir_all(&destination_dir)
        .and_then(|_| fs::copy(source, destination_dir.join("libsodium.pdb")).map(|_| ()))
    {
        println!("cargo:warning=复制 libsodium.pdb 失败：{error}");
    }
}

fn main() {
    configure_windows_libsodium_linking();
    tauri_build::build()
}
