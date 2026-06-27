import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WardenLogger, LogLevel, parseLogLevel } from "../src/logger";

describe("parseLogLevel", () => {
  it("returns INFO for undefined", () => {
    expect(parseLogLevel(undefined)).toBe(LogLevel.INFO);
  });

  it("returns DEBUG for 'debug' (case insensitive)", () => {
    expect(parseLogLevel("debug")).toBe(LogLevel.DEBUG);
    expect(parseLogLevel("DEBUG")).toBe(LogLevel.DEBUG);
  });

  it("returns INFO for 'info'", () => {
    expect(parseLogLevel("info")).toBe(LogLevel.INFO);
  });

  it("returns WARN for 'warn'", () => {
    expect(parseLogLevel("warn")).toBe(LogLevel.WARN);
  });

  it("returns ERROR for 'error'", () => {
    expect(parseLogLevel("error")).toBe(LogLevel.ERROR);
  });

  it("falls back to INFO for unknown values", () => {
    expect(parseLogLevel("trace")).toBe(LogLevel.INFO);
    expect(parseLogLevel("verbose")).toBe(LogLevel.INFO);
  });
});

describe("WardenLogger", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = (vi.spyOn(process.stdout, "write") as unknown as ReturnType<typeof vi.spyOn>).mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("outputs valid single-line JSON", () => {
    const logger = new WardenLogger("test", LogLevel.DEBUG);
    logger.info("hello");

    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    // Output is JSONL: a single JSON object followed by a newline
    expect(() => JSON.parse(output as string)).not.toThrow();
    const lines = output.split("\n");
    // One JSON line plus a trailing empty string from the split
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("");
    expect(() => JSON.parse(lines[0] as string)).not.toThrow();
  });

  it("includes timestamp, level, component, message in log entry", () => {
    const logger = new WardenLogger("test-component", LogLevel.DEBUG);
    logger.warn("test message");

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("WARN");
    expect(parsed.component).toBe("test-component");
    expect(parsed.message).toBe("test message");
    expect(typeof parsed.timestamp).toBe("string");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("merges context fields into log entry", () => {
    const logger = new WardenLogger("test", LogLevel.DEBUG);
    logger.info("msg", { sessionId: "s1", taskId: "t1", custom: 42 });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.sessionId).toBe("s1");
    expect(parsed.taskId).toBe("t1");
    expect(parsed.custom).toBe(42);
  });

  it("suppresses debug when minLevel is INFO", () => {
    const logger = new WardenLogger("test", LogLevel.INFO);
    logger.debug("should not appear");

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("suppresses info when minLevel is WARN", () => {
    const logger = new WardenLogger("test", LogLevel.WARN);
    logger.info("should not appear");

    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("suppresses info and warn when minLevel is ERROR", () => {
    const logger = new WardenLogger("test", LogLevel.ERROR);
    logger.info("should not appear");
    logger.warn("should not appear");
    logger.debug("should not appear");

    expect(writeSpy).not.toHaveBeenCalled();

    logger.error("this should appear");
    expect(writeSpy).toHaveBeenCalledOnce();
  });

  it("allows all levels when minLevel is DEBUG", () => {
    const logger = new WardenLogger("test", LogLevel.DEBUG);

    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    expect(writeSpy).toHaveBeenCalledTimes(4);
  });

  it("logs error message at ERROR level", () => {
    const logger = new WardenLogger("test", LogLevel.DEBUG);
    logger.error("something failed", { toolName: "rm", decision: "DENY" });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);

    expect(parsed.level).toBe("ERROR");
    expect(parsed.toolName).toBe("rm");
    expect(parsed.decision).toBe("DENY");
  });
});
