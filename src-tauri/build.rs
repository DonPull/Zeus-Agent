fn main() {
    tauri_build::build();
    // Unit-test executables also link TaskDialogIndirect via Tauri. Without an
    // embedded v6 common-controls dependency Windows loads comctl32 v5 and
    // aborts before the test harness starts (STATUS_ENTRYPOINT_NOT_FOUND).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        // Tauri already embeds the app manifest in resource.lib for the main
        // binary. Keep that manifest and avoid a second linker-generated one.
        println!("cargo:rustc-link-arg-bin=zeus-agent=/MANIFEST:NO");
        println!("cargo:rustc-link-arg-bin=zeus-evaluation=/MANIFEST:NO");
        println!("cargo:rustc-link-arg-bin=zeus-diagnostics=/MANIFEST:NO");
    }
}
