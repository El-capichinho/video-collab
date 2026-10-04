import { describe, expect, it } from "vitest";
import { FILE_LIMITS, isBlockedFileName, sanitizeFileName, validateUpload } from "@vc/shared";
import { contentDisposition } from "./contentDisposition";

describe("sanitizeFileName", () => {
  it("keeps ordinary names as they are", () => {
    expect(sanitizeFileName("Quarterly report (final).pdf")).toBe("Quarterly report (final).pdf");
    expect(sanitizeFileName("Résumé – Ama.docx")).toBe("Résumé – Ama.docx");
  });

  it("strips folders, so a name can never point somewhere else", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\system32\\evil.txt")).toBe("evil.txt");
    expect(sanitizeFileName("/var/www/index.html")).toBe("index.html");
  });

  it("removes control characters and characters Windows forbids", () => {
    expect(sanitizeFileName("a\u0000b\nc<d>e:f|g?h*.txt")).toBe("abcdefgh.txt");
  });

  it("removes hidden text-direction tricks", () => {
    // Without this, "photo\u202Egpj.exe" would display as "photoexe.jpg"
    expect(sanitizeFileName("photo\u202Egpj.exe")).toBe("photogpj.exe");
  });

  it("removes leading and trailing dots and spaces", () => {
    expect(sanitizeFileName("...hidden")).toBe("hidden");
    expect(sanitizeFileName("report.pdf. . ")).toBe("report.pdf");
    expect(sanitizeFileName("..")).toBe("");
  });

  it("shortens long names but keeps the extension", () => {
    const name = sanitizeFileName(`${"a".repeat(300)}.pdf`);
    expect(name).toHaveLength(FILE_LIMITS.maxNameLength);
    expect(name.endsWith(".pdf")).toBe(true);
  });
});

describe("isBlockedFileName", () => {
  it("blocks programs and scripts, whatever the capitalisation", () => {
    for (const n of ["setup.exe", "run.BAT", "x.ps1", "app.apk", "script.js", "a.tar.sh"]) {
      expect(isBlockedFileName(n)).toBe(true);
    }
  });

  it("catches a double extension", () => {
    expect(isBlockedFileName("invoice.pdf.exe")).toBe(true);
  });

  it("allows documents, images and archives", () => {
    for (const n of ["notes.pdf", "photo.jpg", "data.csv", "slides.pptx", "bundle.zip", "README"]) {
      expect(isBlockedFileName(n)).toBe(false);
    }
  });
});

describe("validateUpload", () => {
  it("accepts a normal file", () => {
    expect(validateUpload("notes.pdf", 1234)).toBeNull();
  });

  it("explains each way a file can be refused", () => {
    expect(validateUpload("", 10)?.code).toBe("bad_name");
    expect(validateUpload("a.txt", 0)?.code).toBe("empty");
    expect(validateUpload("a.txt", FILE_LIMITS.maxFileBytes + 1)?.code).toBe("too_large");
    expect(validateUpload("a.exe", 10)?.code).toBe("blocked_type");
  });

  it("states the size limit in megabytes", () => {
    expect(validateUpload("a.txt", FILE_LIMITS.maxFileBytes + 1)?.message).toBe("Files can be up to 25 MB.");
  });
});

describe("contentDisposition", () => {
  it("forces a download, with the real name encoded", () => {
    const header = contentDisposition("Résumé (1).pdf");
    expect(header.startsWith("attachment;")).toBe(true);
    expect(header).toContain("filename*=UTF-8''R%C3%A9sum%C3%A9%20%281%29.pdf");
  });

  it("gives old clients a safe ASCII fallback with no quotes to break out of", () => {
    const header = contentDisposition('evil"; filename="x.exe');
    expect(header).toContain('filename="evil_; filename=_x.exe"');
    expect(header.match(/"/g)).toHaveLength(2);
  });
});
