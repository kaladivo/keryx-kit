---
channel: security
id: shoe-2026-002
title: "SHOE-2026-002: Lace-in-the-middle attack"
tags: [advisory, laces, integrity]
language: en
image: images/shoe-2026-002.jpg
---

- **Advisory ID:** SHOE-2026-002
- **Published:** 2026-10-26
- **Severity:** High, CVSS 3.1 base score 7.1 (AV:A/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:H)
- **Affected products:** All laced Scuffwell shoes, when both shoes are in the same session
- **Status:** Mitigation available. See below.

## Summary

An attacker positioned between a customer's left and right shoe can tie the two laces together without either shoe noticing.

## Description

Scuffwell shoes do not authenticate the lace they are connected to. An adversary with adjacent access, usually under a dinner table or a desk, can join the left lace to the right lace. Both shoes keep reporting a normal state until the wearer stands up and tries to establish a stride.

The attack needs no privileges and no interaction from the victim beyond standing up, which most victims eventually do.

## Impact

- **Integrity:** low. The laces are unchanged, only their relationship is.
- **Availability:** high. The wearer cannot complete a single step.

## Mitigation

- Mutual authentication. Look down before standing up.
- Keep untrusted parties out of the under-table network, especially at weddings.
- Do not use The Puddle as a workaround in this case. It is not affected, but it will be blamed.

## Credits

Reported independently by two younger siblings and one wedding guest who has asked to remain anonymous.

## Timeline

- 2026-06-13: First exploitation observed in the wild, at a wedding.
- 2026-06-14: The wedding guest apologised.
- 2026-10-26: Advisory published.

Nobody can sit between us and you on this channel. Every post is signed by a Scuffwell author key, so a message altered in transit fails the check and never reaches your inbox.
