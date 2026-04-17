# ossr

`ossr` is a static tracker for public GitHub repositories.

## Configure

Put one public repo per line in
[config/repos.txt](config/repos.txt):

```text
openai/openai-python
octocat/Spoon-Knife
```

Blank lines and `#` comments are ignored. See
[config/repos.example.txt](config/repos.example.txt).

## Run

Generate the snapshot once:

```bash
python3 scripts/generate_snapshot.py --input config/repos.txt --output generated/snapshot.json
```

Run the local dev server with site rebuilds and browser auto-reload:

```bash
python3 scripts/dev_server.py
```

Then open `http://127.0.0.1:8000`.

The dev server watches the repo for file changes, rebuilds the site into `dist/`, and reloads the browser after a successful rebuild. It does not regenerate `generated/snapshot.json` unless you opt in with `--refresh-snapshot`.

If you want each rebuild to refresh the snapshot first:

```bash
python3 scripts/dev_server.py --refresh-snapshot
```

Build the site:

```bash
python3 scripts/build_site.py
```

Run tests:

```bash
python3 -m unittest tests/test_ossr.py
node --test tests/test_app.mjs
```

If `GITHUB_TOKEN` is set, the generator uses it for higher API limits.
