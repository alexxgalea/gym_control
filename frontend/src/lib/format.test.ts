import { formatDateTime } from "@/lib/format";

const HALL = "Europe/Bucharest"; // iarna UTC+2, vara UTC+3

describe("formatarea datelor și orelor", () => {
  const now = new Date("2026-03-10T10:00:00Z"); // 12:00 în ora Sălii

  it("scrie „azi” pentru o oră din ziua curentă", () => {
    expect(formatDateTime("2026-03-10T08:12:00Z", HALL, now)).toBe("azi, 10:12");
  });

  it("scrie „ieri” pentru ziua precedentă", () => {
    expect(formatDateTime("2026-03-09T16:40:00Z", HALL, now)).toBe("ieri, 18:40");
  });

  it("scrie ziua și luna scurtă pentru restul zilelor, fără an în anul curent", () => {
    expect(formatDateTime("2026-01-05T08:12:00Z", HALL, now)).toBe("5 ian., 10:12");
    expect(formatDateTime("2026-09-30T20:05:00Z", HALL, new Date("2026-12-01T10:00:00Z"))).toBe("30 sept., 23:05");
  });

  it("adaugă anul doar când diferă de cel curent", () => {
    expect(formatDateTime("2025-12-31T08:12:00Z", HALL, now)).toBe("31 dec. 2025, 10:12");
  });

  it("folosește ziua din ora Sălii, nu cea din UTC", () => {
    // 22:30 UTC pe 9 martie = 00:30 pe 10 martie în București: e „azi”
    expect(formatDateTime("2026-03-09T22:30:00Z", HALL, now)).toBe("azi, 00:30");
    // 21:59 UTC pe 9 martie = 23:59 pe 9 martie în București: e „ieri”
    expect(formatDateTime("2026-03-09T21:59:00Z", HALL, now)).toBe("ieri, 23:59");
    // „acum” e 23:30 UTC pe 9 martie, adică 01:30 pe 10 martie în Sală
    expect(formatDateTime("2026-03-10T00:00:00Z", HALL, new Date("2026-03-09T23:30:00Z"))).toBe("azi, 02:00");
  });

  it("nu depinde de fusul orar al browserului", () => {
    const original = process.env.TZ;
    try {
      for (const browserTz of ["Pacific/Auckland", "America/Los_Angeles"]) {
        process.env.TZ = browserTz;
        expect(formatDateTime("2026-03-09T22:30:00Z", HALL, now)).toBe("azi, 00:30");
        expect(formatDateTime("2026-03-09T21:59:00Z", HALL, now)).toBe("ieri, 23:59");
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it("tratează schimbarea anului în ora Sălii", () => {
    // 31 dec 22:30 UTC = 1 ian 00:30 în Sală
    const newYear = new Date("2027-01-01T10:00:00Z");
    expect(formatDateTime("2026-12-31T22:30:00Z", HALL, newYear)).toBe("azi, 00:30");
    expect(formatDateTime("2026-12-31T21:30:00Z", HALL, newYear)).toBe("ieri, 23:30");
    expect(formatDateTime("2026-12-30T10:00:00Z", HALL, newYear)).toBe("30 dec. 2026, 12:00");
  });
});
