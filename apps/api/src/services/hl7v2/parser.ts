/**
 * HL7 v2 parser — splits a message into segments and fields.
 *
 * This is intentionally minimal: it handles the canonical delimiter set
 * (`|^~\&`) declared in MSH-2 and performs the inverse of the escaping
 * performed by `segments.ts`. It is used right now only by the unit tests
 * (round-trip parsing of messages we just built) but is written defensively
 * enough to accept inbound messages later.
 *
 * We do NOT bind this to any HTTP endpoint yet — per the spec, inbound HL7
 * v2 is out of scope for this pass.
 */

import { unescapeField } from "./segments";

/** One parsed HL7 segment. Segment id is stripped from `fields`. */
export interface HL7Segment {
  /** Three-char segment id (MSH, PID, OBR, ...). */
  id: string;
  /**
   * Fields indexed 1-based (fields[1] is the FIRST field after the segment
   * id). For MSH specifically, fields[1] is the encoding characters string
   * per HL7 convention — this matches the "MSH-1 = field separator" and
   * "MSH-2 = encoding chars" numbering used by downstream consumers.
   */
  fields: string[];
}

/** A parsed HL7 message — list of segments plus the delimiter set. */
export interface HL7Message {
  segments: HL7Segment[];
  delimiters: {
    field: string;
    component: string;
    repetition: string;
    escape: string;
    subcomponent: string;
  };
}

/**
 * Split a field value on the component separator, unescaping each component.
 * Useful for fields like PID-5 (name) or OBX-3 (code^name^system).
 */
export function parseComponents(field: string, componentSep = "^"): string[] {
  if (!field) return [];
  return field.split(componentSep).map((c) => unescapeField(c));
}

/**
 * Parse a single segment into {id, fields}. MSH is special-cased because the
 * field separator itself appears in column 4 of the raw string (MSH|^~\&|...)
 * and must be treated as the MSH-1 value.
 */
function parseSegment(line: string, fieldSep: string): HL7Segment {
  const id = line.slice(0, 3);
  if (id === "MSH") {
    // MSH-1 is the field separator, MSH-2 is the encoding characters.
    // Raw: "MSH|^~\&|field3|field4|..."
    //       ^^^ id ^ sep  ^^^^ encoding chars
    const afterEncoding = line.slice(8); // skip "MSH|^~\&"
    const rest = afterEncoding.startsWith(fieldSep)
      ? afterEncoding.slice(1)
      : afterEncoding;
    const tail = rest.split(fieldSep).map((f) => unescapeField(f));
    // fields[0] is unused (for parity with segment id slot); fields[1] is
    // field separator; fields[2] is encoding chars; fields[3]... are payload.
    return {
      id,
      fields: [id, fieldSep, line.slice(4, 8), ...tail],
    };
  }

  const parts = line.split(fieldSep);
  // parts[0] is the segment id. Shift so fields[1] is the first data field.
  const fields: string[] = [parts[0]];
  for (let i = 1; i < parts.length; i++) {
    fields.push(unescapeField(parts[i]));
  }
  return { id, fields };
}

/**
 * Parse an HL7 v2 message string into structured segments. Accepts either
 * the canonical `\r` terminator or `\n` / `\r\n` for forgiving inbound use.
 * The MSH segment must be first — we read the delimiter set from it.
 */
export function parseMessage(raw: string): HL7Message {
  if (!raw || !raw.startsWith("MSH")) {
    throw new Error("parseMessage: message must start with MSH");
  }

  // Detect delimiters from the MSH header. MSH-1 is char 3 (field sep);
  // MSH-2 is chars 4-7 (component / repetition / escape / sub-component).
  const fieldSep = raw.charAt(3);
  const componentSep = raw.charAt(4);
  const repetitionSep = raw.charAt(5);
  const escapeChar = raw.charAt(6);
  const subcomponentSep = raw.charAt(7);

  // Split on any CR / LF combination; filter empty lines (trailing CR case).
  const lines = raw.split(/\r\n|\r|\n/).filter((l) => l.length > 0);

  const segments = lines.map((line) => parseSegment(line, fieldSep));

  return {
    segments,
    delimiters: {
      field: fieldSep,
      component: componentSep,
      repetition: repetitionSep,
      escape: escapeChar,
      subcomponent: subcomponentSep,
    },
  };
}

/**
 * Convenience: find the first segment by id (e.g. "PID") and return a field
 * by its 1-based index. Returns `undefined` if the segment or field is absent.
 */
export function getField(
  message: HL7Message,
  segmentId: string,
  fieldIndex: number
): string | undefined {
  const seg = message.segments.find((s) => s.id === segmentId);
  if (!seg) return undefined;
  return seg.fields[fieldIndex];
}

/**
 * Get a specific component within a field (e.g. PID-5.1 for family name).
 * Returns `undefined` if the segment/field/component is missing.
 */
export function getComponent(
  message: HL7Message,
  segmentId: string,
  fieldIndex: number,
  componentIndex: number
): string | undefined {
  const raw = getField(message, segmentId, fieldIndex);
  if (raw === undefined) return undefined;
  const parts = parseComponents(raw, message.delimiters.component);
  return parts[componentIndex - 1]; // 1-based
}

/** Return every segment with the given id (useful for OBX, OBR in ORU). */
export function getSegments(message: HL7Message, segmentId: string): HL7Segment[] {
  return message.segments.filter((s) => s.id === segmentId);
}
