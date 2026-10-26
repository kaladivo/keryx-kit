---
channel: security
id: shoe-2026-001
title: "SHOE-2026-001: Denial of service via tangled shoelaces"
tags: [advisory, laces, availability]
language: en
image: images/shoe-2026-001.jpg
---

- **Advisory ID:** SHOE-2026-001
- **Published:** 2026-10-26
- **Severity:** Medium, CVSS 3.1 base score 4.3 (AV:P/AC:L/PR:N/UI:R/S:U/C:N/I:N/A:H)
- **Affected products:** The Rambler and The Errand, all colours, all sizes, all versions since 2019
- **Not affected:** The Puddle and The Lounger, which have no laces
- **Status:** No fix planned. Laces are working as designed.

## Summary

A lace knot in an unstable state can enter an unbounded tangling loop. The shoe then becomes unavailable to its legitimate owner.

## Description

A single-bow knot that has been worn for more than 40 minutes can partially untie. When the loose end is caught by the opposite foot, the lace accepts arbitrary additional loops without validating them. Each attempt to resolve the tangle while standing makes it worse. The issue is most easily reproduced while running for a tram.

## Impact

Complete loss of availability for one or both shoes. In severe cases, loss of availability of the wearer, who is now sitting on the pavement. No data is exposed. Some dignity is.

## Mitigation

- Use a double knot. This is the vendor-supported configuration.
- Tuck the bows in when the lace is longer than the risk appetite of your morning.
- Customers who need high availability can migrate to The Lounger.

## Credits

Reported by Ema, age 4, who reproduced the issue 11 times in one afternoon and declined to share her proof of concept.

## Timeline

- 2026-09-02: Report received at the Karlín pop-up planning meeting. The reporter was under the table.
- 2026-09-03: Issue confirmed by every member of staff.
- 2026-10-26: Advisory published.

This advisory reached you signed with our key and checked by Keryx against shoe.roguedave.codes. Unlike a lace, nobody else can tie a message to our name.
