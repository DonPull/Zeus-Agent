//! Decode complete SSE lines before decoding UTF-8. HTTP chunks are arbitrary
//! byte boundaries, including boundaries inside one Unicode character.
#[derive(Default)]
pub(crate) struct Lines {
    pending: Vec<u8>,
}

impl Lines {
    pub fn push(&mut self, bytes: &[u8]) {
        self.pending.extend_from_slice(bytes);
    }

    pub fn next(&mut self, eof: bool) -> Result<Option<String>, String> {
        const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;
        let length = match self.pending.iter().position(|byte| *byte == b'\n') {
            Some(index) => index + 1,
            None if eof && !self.pending.is_empty() => self.pending.len(),
            None if self.pending.len() <= MAX_LINE_BYTES => return Ok(None),
            None => return Err("API stream line exceeded 8 MiB".into()),
        };
        if length > MAX_LINE_BYTES {
            return Err("API stream line exceeded 8 MiB".into());
        }
        let bytes: Vec<u8> = self.pending.drain(..length).collect();
        String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| "API stream contained invalid UTF-8 in a complete line".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arbitrary_chunk_boundaries_preserve_unicode_and_line_order() {
        let wire = "event: message\r\ndata: {\"text\":\"Зевс 🎂 café\"}\r\n\r\ndata: [DONE]\n";
        let expected: Vec<_> = wire.split_inclusive('\n').map(str::to_owned).collect();
        for width in 1..=wire.len() {
            let mut decoder = Lines::default();
            let mut actual = vec![];
            for chunk in wire.as_bytes().chunks(width) {
                decoder.push(chunk);
                while let Some(line) = decoder.next(false).unwrap() {
                    actual.push(line);
                }
            }
            assert_eq!(actual, expected, "chunk width {width}");
            assert!(decoder.next(true).unwrap().is_none());
        }
    }

    #[test]
    fn eof_retains_last_complete_line_without_a_newline() {
        let mut decoder = Lines::default();
        decoder.push(b"data: [DONE]");
        assert!(decoder.next(false).unwrap().is_none());
        assert_eq!(decoder.next(true).unwrap().as_deref(), Some("data: [DONE]"));
        assert!(decoder.next(true).unwrap().is_none());
    }

    #[test]
    fn invalid_or_incomplete_unicode_is_an_error_not_silent_loss() {
        for bytes in [vec![0xff, b'\n'], vec![0xf0, 0x9f]] {
            let mut decoder = Lines::default();
            decoder.push(&bytes);
            assert!(decoder.next(true).unwrap_err().contains("invalid UTF-8"));
        }
    }
}
