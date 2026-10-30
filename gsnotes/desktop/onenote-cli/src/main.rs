// GSNotes OneNote converter CLI: wraps Joplin's onenote-converter renderer (MPL-2.0).
// Usage: gsnotes-onenote <input.one|input.onepkg> <output-dir> <base-dir>
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: gsnotes-onenote <input> <output-dir> <base-dir>");
        std::process::exit(2);
    }
    if let Err(e) = renderer::convert(&args[1], &args[2], &args[3]) {
        eprintln!("Error: {:?}", e);
        std::process::exit(1);
    }
}
