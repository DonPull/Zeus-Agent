//! Explicit maintainer action; never starts the app, a browser, or inference.
fn main() {
    let result = run();
    match result {
        Ok(value) => println!("{value}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
fn run() -> Result<serde_json::Value, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage="Usage: zeus-diagnostics export-browser --task UUID --session UUID [--data-dir ABSOLUTE_DIRECTORY]\n       zeus-diagnostics create-ui-showcase [--data-dir ABSOLUTE_DIRECTORY]";
    let showcase = args.first().map(String::as_str) == Some("create-ui-showcase");
    if !showcase && args.first().map(String::as_str) != Some("export-browser") {
        return Err(usage.into());
    }
    let (mut task, mut session) = (None, None);
    let mut index = 1;
    while index < args.len() {
        let value = args.get(index + 1).ok_or(usage)?.clone();
        match args[index].as_str() {
            "--task" => task = Some(value),
            "--session" => session = Some(value),
            "--data-dir" => {
                let path = std::path::PathBuf::from(value);
                if !path.is_absolute() {
                    return Err("Data directory must be absolute".into());
                }
                std::env::set_var("ZEUS_TEST_WORKSPACE_ROOT", path);
            }
            _ => return Err(usage.into()),
        }
        index += 2;
    }
    if showcase {
        return zeus_agent_lib::ui_showcase::create_in_workspace();
    }
    zeus_agent_lib::browser_recordings::export_diagnostic_recording(
        task.ok_or(usage)?,
        session.ok_or(usage)?,
    )
}
