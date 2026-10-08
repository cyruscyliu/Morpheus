/**
 * SDG semantic model: heads, predicates, canonical node ids, and JSON
 * encoding. This file mirrors docs/grammar-extraction.md section 1 (core
 * data structures) and the canonical-id rules of section 4.6.
 *
 * Head model (1.4):
 *   head_guard | head_dataflow | head_bound | head_offset | head_call
 *
 * Predicate model (1.5): the identity of a predicate is its canonical
 * text, which is also the text that appears in rule ids and .sdg
 * condition lines:
 *   bit_set:<bit> | bit_clear:<bit> | eq:<v> | ne:<v>
 *   | <lt|gt|le|ge>:<signed|unsigned>:<v>
 *   | in_range:<signed|unsigned>:<min>:<max> | identity
 */

import cpp

//===----------------------------------------------------------------------===//
// Predicates
//===----------------------------------------------------------------------===//

/**
 * The predicate kind of a canonical predicate text: BitSet, BitClear, Eq,
 * Ne, Lt, Gt, Le, Ge, InRange, or Identity.
 */
bindingset[pred]
string predicateKind(string pred) {
  pred.regexpMatch("^bit_set.*$") and result = "BitSet"
  or
  pred.regexpMatch("^bit_clear.*$") and result = "BitClear"
  or
  pred.regexpMatch("^eq:.*$") and result = "Eq"
  or
  pred.regexpMatch("^ne:.*$") and result = "Ne"
  or
  pred.regexpMatch("^lt:.*$") and result = "Lt"
  or
  pred.regexpMatch("^gt:.*$") and result = "Gt"
  or
  pred.regexpMatch("^le:.*$") and result = "Le"
  or
  pred.regexpMatch("^ge:.*$") and result = "Ge"
  or
  pred.regexpMatch("^in_range.*$") and result = "InRange"
  or
  pred = "identity" and result = "Identity"
}

//===----------------------------------------------------------------------===//
// Name normalization
//===----------------------------------------------------------------------===//

/**
 * Normalizes a kernel callee name to its base name: profiling suffixes,
 * `.N` duplicates, and leading double underscores collapse to the base.
 */
bindingset[name]
string normalizeCalleeName(string name) {
  exists(string n1, string n2 |
    (name.regexpMatch("_noprof$") and
     n1 = name.substring(0, name.length() - "_noprof".length())
     or
     not name.regexpMatch("_noprof$") and n1 = name) and
    (n1.regexpMatch("^[^.]*\\.[0-9]+$") and
     n2 = n1.regexpCapture("^([^.]*)(\\.[0-9]+)$", 1)
     or
     not n1.regexpMatch("^[^.]*\\.[0-9]+$") and n2 = n1) and
    (n2.regexpMatch("^__.*$") and result = n2.substring(2, n2.length())
     or
     not n2.regexpMatch("^__.*$") and result = n2)
  )
}

/**
 * A non-negative integer power of two: 2^n for n in [0..29]. QL integer
 * arithmetic wraps at 2^31, so larger powers cannot round-trip.
 */
int pow2Of(int n) {
  n = 0 and result = 1
  or
  n in [1..29] and result = 2 * pow2Of(n - 1)
}

/** The tested bit of a BitSet / BitClear predicate text. */
bindingset[pred]
int predicateBit(string pred) {
  result = pred.regexpCapture("^bit_(set|clear):([0-9]+)$", 2).toInt()
}

/** The compared constant of a scalar predicate text. */
bindingset[pred]
int predicateValue(string pred) {
  result = pred.regexpCapture("^(eq|ne):([0-9]+)$", 2).toInt()
  or
  result = pred.regexpCapture("^(lt|gt|le|ge):(signed|unsigned):([0-9]+)$", 3).toInt()
}

/** The lower bound of an InRange predicate text. */
bindingset[pred]
int predicateMin(string pred) {
  result = pred.regexpCapture("^in_range:(signed|unsigned):([0-9]+):([0-9]+)$", 2).toInt()
}

/** The upper bound of an InRange predicate text. */
bindingset[pred]
int predicateMax(string pred) {
  result = pred.regexpCapture("^in_range:(signed|unsigned):([0-9]+):([0-9]+)$", 3).toInt()
}

/** The signedness of a relational predicate text: "Signed" or "Unsigned". */
bindingset[pred]
string predicateSignedness(string pred) {
  exists(string s |
    s = pred.regexpCapture("^(lt|gt|le|ge):(signed|unsigned):([0-9]+)$", 2)
    or
    s = pred.regexpCapture("^in_range:(signed|unsigned):([0-9]+):([0-9]+)$", 1) |
    result = s.charAt(0).toUpperCase() + s.substring(1, s.length())
  )
}

/** Holds if `pred` is a relational predicate text (Lt, Gt, Le, Ge, InRange). */
bindingset[pred]
predicate predicateIsRelational(string pred) {
  pred.regexpMatch("^(lt|gt|le|ge):.*$") or pred.regexpMatch("^in_range.*$")
}

/** The JSON object for a canonical predicate text as it appears in rules. */
bindingset[pred]
string predicateJSON(string pred) {
  pred.regexpMatch("^bit_set.*$") and
  result = "{\"kind\":\"BitSet\",\"bit\":" + predicateBit(pred).toString() + "}"
  or
  pred.regexpMatch("^bit_clear.*$") and
  result = "{\"kind\":\"BitClear\",\"bit\":" + predicateBit(pred).toString() + "}"
  or
  pred.regexpMatch("^eq:.*$") and
  result = "{\"kind\":\"Eq\",\"value\":" + predicateValue(pred).toString() + "}"
  or
  pred.regexpMatch("^ne:.*$") and
  result = "{\"kind\":\"Ne\",\"value\":" + predicateValue(pred).toString() + "}"
  or
  pred.regexpMatch("^(lt|gt|le|ge):.*$") and
  result = "{\"kind\":\"" + predicateKind(pred) + "\",\"value\":" +
           predicateValue(pred).toString() +
           ",\"signedness\":\"" + predicateSignedness(pred) + "\"}"
  or
  pred.regexpMatch("^in_range.*$") and
  result = "{\"kind\":\"InRange\",\"min\":" + predicateMin(pred).toString() +
           ",\"max\":" + predicateMax(pred).toString() +
           ",\"signedness\":\"" + predicateSignedness(pred) + "\"}"
  or
  pred = "identity" and result = "{\"kind\":\"Identity\"}"
}

/** The BitSet{bit} predicate text. */
bindingset[bit]
string bitSetPred(int bit) { result = "bit_set:" + bit.toString() }

/** The BitClear{bit} predicate text. */
bindingset[bit]
string bitClearPred(int bit) { result = "bit_clear:" + bit.toString() }

/** The Eq{value} predicate text. */
bindingset[value]
string eqPred(int value) { result = "eq:" + value.toString() }

/** The Ne{value} predicate text. */
bindingset[value]
string nePred(int value) { result = "ne:" + value.toString() }

/** A relational predicate text: kind is Gt, Lt, Ge, or Le. */
bindingset[kind, value, signedness]
string relPred(string kind, int value, string signedness) {
  (kind = "Gt" or kind = "Lt" or kind = "Le" or kind = "Ge") and
  result = kind.toLowerCase() + ":" + signedness.toLowerCase() + ":" + value.toString()
}

/** The InRange{min,max} predicate text. */
bindingset[lo, hi, signedness]
string inRangePred(int lo, int hi, string signedness) {
  result = "in_range:" + signedness.toLowerCase() + ":" + lo.toString() + ":" + hi.toString()
}

/** The Identity predicate text (the dataflow edge predicate). */
string identityPred() { result = "identity" }

/**
 * The negation of a predicate text: Eq<->Ne, BitSet<->BitClear, and the
 * relational pairs Lt<->Ge, Le<->Gt.
 */
bindingset[pred]
string invertedPred(string pred) {
  predicateKind(pred) = "BitSet" and result = bitClearPred(predicateBit(pred))
  or
  predicateKind(pred) = "BitClear" and result = bitSetPred(predicateBit(pred))
  or
  predicateKind(pred) = "Eq" and result = nePred(predicateValue(pred))
  or
  predicateKind(pred) = "Ne" and result = eqPred(predicateValue(pred))
  or
  predicateKind(pred) = "Lt" and
  result = relPred("Ge", predicateValue(pred), predicateSignedness(pred))
  or
  predicateKind(pred) = "Le" and
  result = relPred("Gt", predicateValue(pred), predicateSignedness(pred))
  or
  predicateKind(pred) = "Gt" and
  result = relPred("Le", predicateValue(pred), predicateSignedness(pred))
  or
  predicateKind(pred) = "Ge" and
  result = relPred("Lt", predicateValue(pred), predicateSignedness(pred))
}

//===----------------------------------------------------------------------===//
// Heads
//===----------------------------------------------------------------------===//

/** All head classes of the model (grammar 1.4), for coverage reporting. */
predicate sdgHead(string head) {
  head = "head_guard"
  or
  head = "head_dataflow"
  or
  head = "head_bound"
  or
  head = "head_offset"
  or
  head = "head_call"
}

/** All predicate kinds of the model (grammar 1.5), for coverage reporting. */
predicate sdgPredicateKind(string kind) {
  kind = "BitSet"
  or
  kind = "BitClear"
  or
  kind = "Eq"
  or
  kind = "Ne"
  or
  kind = "Lt"
  or
  kind = "Gt"
  or
  kind = "Le"
  or
  kind = "Ge"
  or
  kind = "InRange"
  or
  kind = "Identity"
}

//===----------------------------------------------------------------------===//
// JSON encoding helpers
//===----------------------------------------------------------------------===//

/** Escapes a string for inclusion in a JSON string literal. */
bindingset[s]
string jsonEscape(string s) {
  exists(string noBackslash, string noQuote |
    noBackslash = s.replaceAll("\\", "\\\\") and
    noQuote = noBackslash.replaceAll("\"", "\\\"") and
    result = noQuote.replaceAll("\n", "\\n")
  )
}

/** Encodes a string as a JSON string literal. */
bindingset[s]
string jsonString(string s) { result = "\"" + jsonEscape(s) + "\"" }

/** Encodes a location as a JSON object: file and line. */
bindingset[l]
string jsonLocation(Locatable l) {
  exists(Location loc, int line |
    loc = l.getLocation() and
    loc.hasLocationInfo(_, line, _, _, _) and
    result = "{\"file\":\"" + jsonEscape(loc.getFile().getBaseName()) +
             "\",\"line\":" + line.toString() + "}"
  )
  or
  not exists(Location loc | loc = l.getLocation() and loc.hasLocationInfo(_, _, _, _, _)) and
  result = "{\"file\":\"\",\"line\":0}"
}
