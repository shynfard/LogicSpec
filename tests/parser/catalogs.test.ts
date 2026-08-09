import { describe, expect, it } from "vitest";
import { parseEvents, parseServices } from "../../src/index.js";

describe("parseServices", () => {
  it("parses all operation kinds", () => {
    const result = parseServices(`
version: "1"
services:
  booking:
    name: Booking
    operations:
      list: { kind: http, method: GET, path: /x }
      grpc-op: { kind: grpc, service: Booking, method: Reserve }
      calc: { kind: internal, operation: calculatePrice }
      cmd: { kind: command, command: sync }
      misc: { kind: other, protocol: mqtt }
`);
    expect(result.ok).toBe(true);
    expect(Object.keys(result.data?.services.booking?.operations ?? {})).toHaveLength(5);
  });

  it("rejects an unknown operation kind", () => {
    const result = parseServices(`
version: "1"
services:
  booking:
    operations:
      list: { kind: websocket }
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("LS002");
  });

  it("rejects an invalid http method", () => {
    const result = parseServices(`
version: "1"
services:
  booking:
    operations:
      list: { kind: http, method: FETCH, path: /x }
`);
    expect(result.ok).toBe(false);
  });
});

describe("parseEvents", () => {
  it("parses an event catalog", () => {
    const result = parseEvents(`
version: "1"
events:
  BookingCreated:
    topic: booking.created
    producer: booking
    consumers: [notification]
    payload:
      schema: ./schemas/booking-created.json
`);
    expect(result.ok).toBe(true);
    expect(result.data?.events.BookingCreated?.topic).toBe("booking.created");
  });

  it("rejects unknown event properties", () => {
    const result = parseEvents(`
version: "1"
events:
  BookingCreated:
    topik: booking.created
`);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.message).toContain("topik");
  });
});
