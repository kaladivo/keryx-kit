---
channel: security
id: shoe-2026-003
title: "SHOE-2026-003: Sole replay attack"
tags: [advisory, soles, authenticity]
language: en
image: images/shoe-2026-003.jpg
---

- **Advisory ID:** SHOE-2026-003
- **Published:** 2026-10-26
- **Severity:** Low, CVSS 3.1 base score 2.9 (AV:P/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N)
- **Affected products:** All Scuffwell soles with a tread pattern, which is all of them
- **Status:** Mitigation available. Fix shipping with every resole.

## Summary

A captured footprint can be replayed to make it look as if the owner of the shoe walked somewhere they did not.

## Description

Scuffwell outsoles produce a distinctive, repeatable tread impression in mud, snow, fresh concrete and flour. The impression carries no timestamp and no nonce. An attacker who obtains a pair with the same tread, or simply borrows yours, can replay the footprint at a different time and place.

In the reported case, muddy prints appeared across a freshly mopped kitchen floor. The household's verification process matched the prints to the victim's Ramblers and rejected the statement "it wasn't me" without further review.

## Impact

Loss of reputation within the household. Mild confidentiality impact: the tread reveals your shoe size to anyone holding a ruler.

## Mitigation

- Wipe your feet at the door. This invalidates any session in progress.
- Rotate your tread. A resole replaces the pattern; the first two years are free.
- Keep your shoes where you can see them. Physical access is still game over.

## Credits

Reported by a household in Brno that has since reviewed its incident response process.

## Timeline

- 2026-08-21: Incident on a mopped kitchen floor.
- 2026-08-22: Victim asked us for a statement. We sent one.
- 2026-10-26: Advisory published.

A footprint proves very little. A signed post proves who wrote it: Keryx shows only posts signed with the keys that shoe.roguedave.codes publishes, so nobody can walk around in our name.
