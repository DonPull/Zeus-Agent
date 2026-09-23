use zeus_agent_lib::output_compressor::{
    compress_tool_output, strip_ansi_codes, COMPRESSION_THRESHOLD_CHARS, HEAD_LINES_PRESERVE, TAIL_LINES_PRESERVE,
};

#[test]
fn test_strip_ansi_codes_and_carriage_returns() {
    let colored = "\x1B[32mPASS\x1B[0m: test_one\n\x1B[31mFAIL\x1B[0m: test_two\r\nProgress: 50%\rProgress: 100%";
    let clean = strip_ansi_codes(colored);
    assert!(clean.contains("PASS: test_one"));
    assert!(clean.contains("FAIL: test_two"));
    assert!(clean.contains("Progress: 100%"));
    assert!(!clean.contains("\x1B"));
}

#[test]
fn test_short_tool_output_is_untouched() {
    let short_output = "Short output from git status.\nOn branch main\nNothing to commit.";
    assert!(short_output.len() <= COMPRESSION_THRESHOLD_CHARS);

    let compressed = compress_tool_output("test_task_1", "git_status", short_output, Some(0));
    assert_eq!(compressed, short_output);
}

#[test]
fn test_large_output_compression_with_artifacts() {
    let mut lines = Vec::new();
    for i in 1..=300 {
        lines.push(format!("Line {:03}: detailed build debug log information for component module {}", i, i));
    }
    let raw = lines.join("\n");
    assert!(raw.len() > COMPRESSION_THRESHOLD_CHARS);

    let compressed = compress_tool_output("compressor_test_task", "cargo_build", &raw, Some(101));

    // Must preserve head lines and tail lines
    assert!(compressed.contains(&format!("first {} lines", HEAD_LINES_PRESERVE)));
    assert!(compressed.contains(&format!("last {} lines", TAIL_LINES_PRESERVE)));
    assert!(compressed.contains("Line 001: detailed build debug log"));
    assert!(compressed.contains("Line 015: detailed build debug log"));
    assert!(compressed.contains("Line 300: detailed build debug log"));
    assert!(compressed.contains("Exit Code: 101"));

    // Omission marker must specify omitted count and artifact path
    let expected_omitted = 300 - (HEAD_LINES_PRESERVE + TAIL_LINES_PRESERVE);
    assert!(compressed.contains(&format!("{} lines omitted", expected_omitted)));
    assert!(compressed.contains("tool_output_"));
    assert!(compressed.contains("use read_file if you need to inspect full details"));
}

#[test]
fn test_wide_single_lines_compression() {
    // Only 2 lines, but total length exceeds threshold
    let long_line = "A".repeat(3000);
    let raw = format!("Start\n{}\nEnd", long_line);

    let compressed = compress_tool_output("compressor_test_task", "minified_bundle", &raw, Some(0));
    assert!(compressed.contains("line truncated"));
    assert!(compressed.contains("Full raw output"));
}
