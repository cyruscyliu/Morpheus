//! Corpus metadata records for semantic scenarios.
//!
//! One record is stored per corpus input, keyed by the SHA-256 of the exact
//! parent encoded `ScenarioInput` bytes. The encoded wire bytes remain the
//! authoritative replay input; the metadata is mutation provenance only and
//! never affects replay. A lookup for bytes without a record — or with a
//! stale record — returns `None`, and the caller must fall back instead of
//! guessing placement from the wire layout.
//!
//! When persistence is enabled the store keeps one sidecar record per input
//! as `<digest>.json` inside a dedicated directory outside the corpus file
//! enumeration (a sibling of the corpus directory). Records are written
//! atomically with a temp file plus rename in the same directory. Lookups
//! that miss the in-memory map lazy-load the sidecar record and verify its
//! internal digest against both the computed digest and the file name, so
//! corrupt or renamed records are rejected. Records persisted for a child
//! that is never accepted by the fuzzer are harmless orphans: they are
//! digest-keyed and can only ever be found for those exact bytes.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use alloc::collections::BTreeMap;
use alloc::sync::Arc;
use serde::{Deserialize, Serialize};
use sha2::Digest;

use crate::input::{sha256_of_input, ScenarioInput};
use crate::sdg::SemanticScenario;

/// SHA-256 digest of the exact parent encoded `ScenarioInput` bytes.
pub type ScenarioDigest = [u8; 32];

/// One in-memory record plus its least-recently-used stamp. Eviction is
/// least-recently-used, never digest order.
#[derive(Debug)]
struct StoreEntry {
    scenario: SemanticScenario,
    last_used: u64,
}

#[derive(Debug, Default)]
struct StoreInner {
    entries: BTreeMap<ScenarioDigest, StoreEntry>,
    /// Sidecar directory for `<digest>.json` records; `None` keeps the
    /// store in-process only.
    persistent_dir: Option<PathBuf>,
    /// In-memory record cap; `None` keeps every record resident. A capped
    /// store requires persistence so evicted records stay recoverable from
    /// the sidecar.
    limit: Option<usize>,
    clock: u64,
}

impl StoreInner {
    /// Touch an entry's LRU stamp and return a clone of its scenario.
    fn touch(&mut self, digest: &ScenarioDigest) -> Option<SemanticScenario> {
        let entry = self.entries.get_mut(digest)?;
        self.clock += 1;
        entry.last_used = self.clock;
        Some(entry.scenario.clone())
    }

    /// Insert a record with LRU bookkeeping, evicting the least recently
    /// used record when the cap is reached. Evicted records remain
    /// recoverable from the sidecar.
    fn insert(&mut self, digest: ScenarioDigest, scenario: SemanticScenario) {
        self.clock += 1;
        let last_used = self.clock;
        if !self.entries.contains_key(&digest)
            && let Some(limit) = self.limit
        {
            while self.entries.len() >= limit {
                let oldest = self
                    .entries
                    .iter()
                    .min_by_key(|(_, entry)| entry.last_used)
                    .map(|(digest, _)| *digest);
                match oldest {
                    Some(oldest) => {
                        self.entries.remove(&oldest);
                    }
                    None => break,
                }
            }
        }
        self.entries.insert(digest, StoreEntry { scenario, last_used });
    }
}

/// A shared registry of semantic scenarios keyed by the SHA-256 of the exact
/// encoded `ScenarioInput` bytes. Clones share the same records, so a
/// generator and a mutator cloned from the same instance see one registry,
/// and separate processes see one sidecar directory.
#[derive(Clone, Debug, Default)]
pub struct ScenarioMetadataStore {
    inner: Arc<Mutex<StoreInner>>,
}

impl ScenarioMetadataStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// A store that persists every record as `<digest>.json` under `dir`.
    #[must_use]
    pub fn persistent(dir: &Path) -> Self {
        let store = Self::new();
        store.enable_persistence(dir);
        store
    }

    /// A persistent store with a bounded in-memory map. Eviction is least
    /// recently used and always recoverable: every registered record is
    /// persisted to the sidecar before it can be evicted.
    #[must_use]
    pub fn persistent_with_limit(dir: &Path, limit: usize) -> Self {
        let store = Self::persistent(dir);
        {
            let mut inner = match store.inner.lock() {
                Ok(inner) => inner,
                Err(poisoned) => poisoned.into_inner(),
            };
            inner.limit = Some(limit);
        }
        store
    }

    /// Enable persistent sidecar records under `dir`. Records are written
    /// atomically as `<digest>.json` and lazy-loaded on lookup.
    pub fn enable_persistence(&self, dir: &Path) {
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        inner.persistent_dir = Some(dir.to_path_buf());
    }

    /// The configured sidecar directory, when persistence is enabled.
    #[must_use]
    pub fn persistent_dir(&self) -> Option<PathBuf> {
        match self.inner.lock() {
            Ok(inner) => inner.persistent_dir.clone(),
            Err(poisoned) => poisoned.into_inner().persistent_dir.clone(),
        }
    }

    /// Sibling sidecar directory for a corpus: `<corpus-name>.sdg-metadata`.
    /// A sibling stays outside the corpus directory, so `OnDiskCorpus` never
    /// interprets a metadata record as a testcase.
    #[must_use]
    pub fn sidecar_dir_for_corpus(corpus_dir: &Path) -> PathBuf {
        let name = corpus_dir
            .components()
            .next_back()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "corpus".to_string());
        corpus_dir.with_file_name(format!("{name}.sdg-metadata"))
    }

    /// Compute the digest key for a scenario's encoded wire bytes.
    #[must_use]
    pub fn digest_of_input(input: &ScenarioInput) -> ScenarioDigest {
        sha256_of_input(input)
    }

    /// Compute the digest key for exact encoded wire bytes.
    #[must_use]
    pub fn digest_of_bytes(encoded: &[u8]) -> ScenarioDigest {
        let mut hasher = sha2::Sha256::new();
        hasher.update(encoded);
        hasher.finalize().into()
    }

    /// Hex-encode a digest for record files and provenance records.
    #[must_use]
    pub fn hex_digest(digest: &ScenarioDigest) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut out = String::with_capacity(digest.len() * 2);
        for b in digest {
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0xf) as usize] as char);
        }
        out
    }

    /// Register the semantic scenario recorded for these exact input bytes.
    /// The scenario's placements must already be complete; lowering fills
    /// any missing placement before registration. When persistence is
    /// configured the record is written atomically to the sidecar.
    pub fn register(&self, input: &ScenarioInput, scenario: SemanticScenario) {
        self.register_bytes(&Self::encode(input), scenario);
    }

    /// Register the semantic scenario recorded for these exact bytes.
    pub fn register_bytes(&self, encoded: &[u8], scenario: SemanticScenario) {
        let digest = Self::digest_of_bytes(encoded);
        let mut inner = Self::lock(&self.inner);
        // Persist before the in-memory insert: the record must be on the
        // sidecar before it can ever be evicted from memory. The write is
        // atomic (temp file + rename in the sidecar directory).
        if let Some(dir) = inner.persistent_dir.clone() {
            Self::persist_to(&dir, &digest, &scenario);
        }
        inner.insert(digest, scenario);
    }

    /// Look up the semantic scenario recorded for these exact input bytes.
    /// On an in-memory miss the sidecar record is lazy-loaded and verified
    /// against both the computed digest and the file name. Returns `None`
    /// when no record exists or a record is corrupt or stale: the caller
    /// must never guess a region or visit from the wire layout.
    #[must_use]
    pub fn lookup(&self, input: &ScenarioInput) -> Option<SemanticScenario> {
        self.lookup_bytes(&Self::encode(input))
    }

    /// Look up the semantic scenario recorded for these exact bytes.
    #[must_use]
    pub fn lookup_bytes(&self, encoded: &[u8]) -> Option<SemanticScenario> {
        let digest = Self::digest_of_bytes(encoded);
        let mut inner = Self::lock(&self.inner);
        if let Some(scenario) = inner.touch(&digest) {
            return Some(scenario);
        }
        // In-memory miss: lazy-load the sidecar record for these bytes.
        let dir = inner.persistent_dir.clone()?;
        let hex = Self::hex_digest(&digest);
        let path = dir.join(format!("{hex}.json"));
        let stem = path.file_stem()?.to_str()?.to_string();
        let text = fs::read_to_string(&path).ok()?;
        let record: ScenarioMetadata = serde_json::from_str(&text).ok()?;
        // The record's own digest must match both the computed digest and
        // the file name; anything else is corrupt or stale.
        if record.encoded_scenario_sha256 != hex || record.encoded_scenario_sha256 != stem {
            return None;
        }
        let scenario = record.scenario;
        inner.insert(digest, scenario.clone());
        Some(scenario)
    }

    /// Number of resident in-memory records. Sidecar-only records are not
    /// counted until a lookup loads them.
    #[must_use]
    pub fn len(&self) -> usize {
        match self.inner.lock() {
            Ok(inner) => inner.entries.len(),
            Err(poisoned) => poisoned.into_inner().entries.len(),
        }
    }

    /// Whether the store holds no resident records.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Persist every resident record to `dir` as one JSON file per digest,
    /// named `<hex-digest>.json`. The records are mutation provenance stored
    /// alongside corpus inputs; they are never replayed. Returns the number
    /// of records written.
    pub fn save_to_dir(&self, dir: &Path) -> std::io::Result<usize> {
        fs::create_dir_all(dir)?;
        let inner = Self::lock(&self.inner);
        let mut count = 0usize;
        for (digest, entry) in &inner.entries {
            Self::persist_to(dir, digest, &entry.scenario);
            count += 1;
        }
        Ok(count)
    }

    /// Bulk-load sidecar records previously written by `save_to_dir` or
    /// `register`. A record whose stored digest disagrees with its file
    /// name is rejected as stale instead of being registered. Returns the
    /// number of records loaded.
    pub fn load_from_dir(&self, dir: &Path) -> std::io::Result<usize> {
        let mut count = 0usize;
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let stem = path.file_stem().and_then(|x| x.to_str()).unwrap_or("").to_string();
            let Ok(text) = fs::read_to_string(&path) else { continue };
            let Ok(record) = serde_json::from_str::<ScenarioMetadata>(&text) else {
                continue;
            };
            if record.encoded_scenario_sha256 != stem {
                continue;
            }
            let Ok(digest) = Self::parse_hex_digest(&stem) else { continue };
            let mut inner = Self::lock(&self.inner);
            inner.insert(digest, record.scenario);
            count += 1;
        }
        Ok(count)
    }

    /// Write one sidecar record atomically: a temp file plus rename inside
    /// the same directory. A failed write is best-effort: the record stays
    /// in memory and the next registration retries.
    fn persist_to(dir: &Path, digest: &ScenarioDigest, scenario: &SemanticScenario) {
        let record = ScenarioMetadata {
            encoded_scenario_sha256: Self::hex_digest(digest),
            scenario: scenario.clone(),
        };
        let Ok(json) = serde_json::to_string(&record) else { return };
        if fs::create_dir_all(dir).is_err() {
            return;
        }
        let final_path = dir.join(format!("{}.json", record.encoded_scenario_sha256));
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp_path = dir.join(format!(".{}.tmp-{nanos}", record.encoded_scenario_sha256));
        if fs::write(&tmp_path, json).is_ok() {
            // Rename inside the same directory is atomic on POSIX.
            if fs::rename(&tmp_path, &final_path).is_err() {
                let _ = fs::remove_file(&tmp_path);
            }
        } else {
            let _ = fs::remove_file(&tmp_path);
        }
    }

    fn parse_hex_digest(text: &str) -> Result<ScenarioDigest, String> {
        if text.len() != 64 {
            return Err(format!("digest {text} is not 64 hex characters"));
        }
        let mut digest = [0u8; 32];
        for (index, byte) in digest.iter_mut().enumerate() {
            let high = text.as_bytes()[index * 2];
            let low = text.as_bytes()[index * 2 + 1];
            let from_hex = |c: u8| -> Result<u8, String> {
                match c {
                    b'0'..=b'9' => Ok(c - b'0'),
                    b'a'..=b'f' => Ok(c - b'a' + 10),
                    _ => Err(format!("invalid hex character {}", c as char)),
                }
            };
            *byte = (from_hex(high)? << 4) | from_hex(low)?;
        }
        Ok(digest)
    }

    fn lock(inner: &Arc<Mutex<StoreInner>>) -> MutexGuard<'_, StoreInner> {
        match inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn encode(input: &ScenarioInput) -> alloc::vec::Vec<u8> {
        crate::encoding::encode_scenario(input)
    }
}

/// Mutation provenance for one corpus input: the SHA-256 of the exact parent
/// encoded bytes plus the semantic scenario recorded when those bytes were
/// lowered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenarioMetadata {
    /// Hex-encoded SHA-256 of the exact parent encoded `ScenarioInput` bytes.
    pub encoded_scenario_sha256: String,
    /// The semantic scenario recorded at generation or mutation time,
    /// including the exact per-field placements.
    pub scenario: SemanticScenario,
}

#[cfg(test)]
mod tests {
    use super::{ScenarioDigest, ScenarioMetadataStore, StoreInner};
    use crate::input::{DmaSection, MmioSection, ScenarioInput, WordModel};
    use crate::sdg::{Node, Placement, SemanticScenario, Source, Value};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn word(offset: u32, values: &[u32]) -> WordModel {
        WordModel {
            offset,
            values: values.to_vec(),
        }
    }

    fn sample_input(tag: u32) -> ScenarioInput {
        ScenarioInput::new(
            MmioSection {
                word_models: vec![word(0x110, &[0x7472_6976 + tag])],
            },
            DmaSection::default(),
        )
    }

    fn sample_scenario(target_rule: &str) -> SemanticScenario {
        let mut scenario = SemanticScenario {
            target_rule: target_rule.into(),
            ..Default::default()
        };
        let node = Node {
            name: "mmio:273:1:x".into(),
            source: Source::Mmio { offset: 0x111, size: 1 },
            width_bits: 8,
        };
        scenario.insert_node(node);
        scenario.set("mmio:273:1:x".into(), Value::U8(41));
        scenario.insert_placement("mmio:273:1:x", Placement { region: 0, visit: 0 });
        scenario
    }

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "sdg-metadata-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn resident_digests(store: &ScenarioMetadataStore) -> Vec<ScenarioDigest> {
        let inner = store.inner.lock().unwrap();
        inner.entries.keys().copied().collect()
    }

    #[test]
    fn register_and_lookup_are_keyed_to_exact_bytes() {
        let store = ScenarioMetadataStore::new();
        let input = sample_input(0);
        assert!(store.lookup(&input).is_none(), "an unregistered input has no metadata");

        store.register(&input, sample_scenario("rule:test"));
        assert_eq!(store.len(), 1);
        let found = store.lookup(&input).expect("the exact bytes must find the record");
        assert_eq!(found.target_rule, "rule:test");
        assert_eq!(
            found.value("mmio:273:1:x").and_then(Value::as_u64),
            Some(41)
        );
        assert_eq!(
            found.placements.get("mmio:273:1:x").copied(),
            Some(Placement { region: 0, visit: 0 })
        );
    }

    #[test]
    fn changed_bytes_are_stale_metadata() {
        let store = ScenarioMetadataStore::new();
        let input = sample_input(0);
        store.register(&input, sample_scenario("rule:test"));

        let mut changed = input.clone();
        changed.mmio.word_models[0].values[0] = 0;
        assert!(store.lookup(&changed).is_none(), "changed bytes must not find the parent metadata");
        // The parent bytes still find their record.
        assert!(store.lookup(&input).is_some());
    }

    #[test]
    fn digests_match_sha256_of_encoded_bytes() {
        let input = sample_input(0);
        let encoded = crate::encoding::encode_scenario(&input);
        let by_input = ScenarioMetadataStore::digest_of_input(&input);
        let by_bytes = ScenarioMetadataStore::digest_of_bytes(&encoded);
        let empty: ScenarioDigest = [0u8; 32];
        assert_ne!(by_input, empty);
        assert_eq!(by_input, by_bytes);
        // Registering by bytes finds the same record by input.
        let store = ScenarioMetadataStore::new();
        store.register_bytes(&encoded, sample_scenario("rule:bytes"));
        assert!(store.lookup(&input).is_some());
    }

    #[test]
    fn persistent_register_writes_sidecar_and_restart_lazy_loads() {
        let dir = temp_dir("sidecar");
        let input = sample_input(0);

        // First store: registration persists the sidecar record atomically.
        let first = ScenarioMetadataStore::persistent(&dir);
        first.register(&input, sample_scenario("rule:restart"));
        let digest = ScenarioMetadataStore::hex_digest(
            &ScenarioMetadataStore::digest_of_input(&input),
        );
        let sidecar = dir.join(format!("{digest}.json"));
        assert!(sidecar.is_file(), "register must persist <digest>.json");
        // No temp files remain after the atomic rename.
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with('.'))
            })
            .collect();
        assert!(leftovers.is_empty(), "the atomic rename must leave no temp file");

        // A second, independent store (a restarted process) lazy-loads the
        // first store's record from the sidecar.
        let restarted = ScenarioMetadataStore::persistent(&dir);
        assert_eq!(restarted.len(), 0, "a fresh store starts empty");
        let found = restarted.lookup(&input).expect("the sidecar record must lazy-load");
        assert_eq!(found.target_rule, "rule:restart");
        assert_eq!(
            found.value("mmio:273:1:x").and_then(Value::as_u64),
            Some(41)
        );
        assert_eq!(
            found.placements.get("mmio:273:1:x").copied(),
            Some(Placement { region: 0, visit: 0 })
        );
        assert_eq!(restarted.len(), 1, "the loaded record is resident");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn corrupt_sidecar_json_is_rejected() {
        let dir = temp_dir("corrupt");
        let input = sample_input(0);
        let digest = ScenarioMetadataStore::hex_digest(
            &ScenarioMetadataStore::digest_of_input(&input),
        );
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{digest}.json")), "not json at all").unwrap();

        let store = ScenarioMetadataStore::persistent(&dir);
        assert!(store.lookup(&input).is_none(), "corrupt JSON must be rejected");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sidecar_internal_digest_mismatch_is_rejected() {
        // A record whose internal digest disagrees with the computed digest
        // or the file name must be rejected instead of applied.
        let dir = temp_dir("mismatch");
        let input = sample_input(0);
        let digest = ScenarioMetadataStore::digest_of_input(&input);
        let record = super::ScenarioMetadata {
            encoded_scenario_sha256: "a".repeat(64),
            scenario: sample_scenario("rule:forged"),
        };
        let json = serde_json::to_string(&record).unwrap();
        std::fs::create_dir_all(&dir).unwrap();
        // Stored under the real digest's file name, but the internal digest
        // differs.
        std::fs::write(
            dir.join(format!("{}.json", ScenarioMetadataStore::hex_digest(&digest))),
            json,
        )
        .unwrap();

        let store = ScenarioMetadataStore::persistent(&dir);
        assert!(
            store.lookup(&input).is_none(),
            "a record whose internal digest disagrees with its file must be rejected"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn sidecar_filename_digest_mismatch_is_rejected() {
        // A valid record for one digest stored under a different file name
        // must be rejected.
        let dir = temp_dir("renamed");
        let input = sample_input(0);
        let first = ScenarioMetadataStore::persistent(&dir);
        first.register(&input, sample_scenario("rule:test"));
        let digest = ScenarioMetadataStore::hex_digest(
            &ScenarioMetadataStore::digest_of_input(&input),
        );
        let renamed = dir.join(format!("{}0.json", &digest[..63]));
        std::fs::rename(dir.join(format!("{digest}.json")), &renamed).unwrap();

        let restarted = ScenarioMetadataStore::persistent(&dir);
        assert!(restarted.lookup(&input).is_none(), "a renamed record must not load");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn lru_cap_evicts_least_recently_used_and_sidecar_recovers() {
        let dir = temp_dir("lru");
        let first_input = sample_input(0);
        let second_input = sample_input(1);
        let third_input = sample_input(2);

        let store = ScenarioMetadataStore::persistent_with_limit(&dir, 2);
        store.register(&first_input, sample_scenario("rule:first"));
        store.register(&second_input, sample_scenario("rule:second"));
        assert_eq!(store.len(), 2);
        // Touch the first record so it becomes the most recently used.
        assert!(store.lookup(&first_input).is_some());
        // A third registration must evict the least recently used record
        // (the second), never by digest order.
        store.register(&third_input, sample_scenario("rule:third"));
        assert_eq!(store.len(), 2, "the cap bounds the resident map");

        let resident = resident_digests(&store);
        let first_digest = ScenarioMetadataStore::digest_of_input(&first_input);
        let second_digest = ScenarioMetadataStore::digest_of_input(&second_input);
        let third_digest = ScenarioMetadataStore::digest_of_input(&third_input);
        assert!(resident.contains(&first_digest), "the touched record stays resident");
        assert!(resident.contains(&third_digest), "the newest record stays resident");
        assert!(!resident.contains(&second_digest), "the least recently used record was evicted");

        // The evicted record is still recoverable from the sidecar.
        let found = store.lookup(&second_input).expect("the sidecar must recover the evicted record");
        assert_eq!(found.target_rule, "rule:second");
        // The lookup made it resident again, so another record was evicted.
        let resident = resident_digests(&store);
        assert!(resident.contains(&second_digest));
        assert_eq!(resident.len(), 2);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn resident_map_matches_store_inner() {
        // Sanity for the LRU bookkeeping helpers against the raw map.
        let mut inner = StoreInner::default();
        let a = [1u8; 32];
        let b = [2u8; 32];
        inner.insert(a, sample_scenario("rule:a"));
        inner.insert(b, sample_scenario("rule:b"));
        assert!(inner.touch(&a).is_some());
        assert!(inner.touch(&[3u8; 32]).is_none());
        inner.limit = Some(2);
        inner.insert([4u8; 32], sample_scenario("rule:c"));
        assert_eq!(inner.entries.len(), 2);
        assert!(!inner.entries.contains_key(&b), "the untouched record was evicted");
    }

    #[test]
    fn sidecar_dir_is_a_sibling_outside_the_corpus() {
        let corpus = std::path::Path::new("/tmp/example/corpus");
        let sidecar = ScenarioMetadataStore::sidecar_dir_for_corpus(corpus);
        assert_eq!(sidecar, std::path::Path::new("/tmp/example/corpus.sdg-metadata"));
        assert_ne!(sidecar, corpus);
        // The sidecar is not inside the corpus directory, so an
        // OnDiskCorpus enumeration never sees a metadata record.
        assert!(!sidecar.starts_with(corpus));
        let trailing = ScenarioMetadataStore::sidecar_dir_for_corpus(std::path::Path::new(
            "/tmp/example/corpus/",
        ));
        assert_eq!(trailing, std::path::Path::new("/tmp/example/corpus.sdg-metadata"));
    }

    #[test]
    fn records_round_trip_through_a_directory() {
        let store = ScenarioMetadataStore::new();
        let input = sample_input(0);
        store.register(&input, sample_scenario("rule:test"));

        let dir = temp_dir("bulk");
        let saved = store.save_to_dir(&dir).expect("records should persist");
        assert_eq!(saved, 1);

        let loaded = ScenarioMetadataStore::new();
        let count = loaded.load_from_dir(&dir).expect("records should load");
        assert_eq!(count, 1);
        assert!(loaded.lookup(&input).is_some(), "loaded records find the exact bytes");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn concurrent_clones_share_records() {
        let dir = temp_dir("shared");
        let store = ScenarioMetadataStore::persistent(&dir);
        let input = sample_input(0);
        store.register(&input, sample_scenario("rule:shared"));

        // A clone (as the fuzzer hands to the mutator) sees the records.
        let clone = store.clone();
        assert!(clone.lookup(&input).is_some());
        // ... and a registration through the clone is visible to the store.
        let other = sample_input(1);
        clone.register(&other, sample_scenario("rule:clone"));
        assert!(store.lookup(&other).is_some());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
