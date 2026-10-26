---
channel: security
id: shoe-2026-004
title: "SHOE-2026-004: Phishing campaign selling fake Cloud Insoles"
tags: [advisory, phishing, scam]
language: en
image: images/shoe-2026-004.jpg
---

- **Advisory ID:** SHOE-2026-004
- **Published:** 2026-10-26
- **Severity:** Critical, CVSS 3.1 base score 9.6 (AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H)
- **Affected products:** None. Scuffwell does not make Cloud Insoles. This is the problem.
- **Status:** Active campaign. Read the mitigation.

## Summary

Emails and text messages are offering "Scuffwell Cloud Insoles" at 70% off. To "calibrate the cushioning", the order form asks for your shoe size, your email password and your wallet recovery seed.

## Description

The messages use our name, our logo and a photo of a Rambler taken from our website. They link to a lookalike domain and create urgency with a countdown timer that resets every time you reload the page. After you enter your details, nothing is shipped. Your accounts, and anything your recovery seed protects, are emptied instead.

There is no such thing as a Cloud Insole. Cushioning does not need calibrating. No insole has ever needed your seed phrase.

## Impact

Full compromise of any account or wallet whose password, code or seed you enter. Your feet are not affected.

## Mitigation

- **We will never ask you for a password, a seed phrase or a code.** Not by email, not by text, not on the phone, and not in this channel.
- Our real announcements arrive in Keryx, signed, from shoe.roguedave.codes. Anything that arrives any other way is not from us, however good the photo is.
- If you already entered a seed, move your funds to a new wallet now, from a device you trust. Change any password you typed in.
- Forward the message to your email provider's abuse address and delete it.

## Credits

Thanks to the 38 customers who forwarded the emails to us, and to the one who replied to the scammers with a shoe size and nothing else.

## Timeline

- 2026-10-19: First message reported.
- 2026-10-20: Lookalike domain reported to its registrar.
- 2026-10-26: Advisory published.

This is why we moved our announcements to Keryx. A scammer can copy our logo, but they can't sign a post with our key, so a fake Scuffwell message never shows up next to this one.
