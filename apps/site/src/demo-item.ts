import type { Item } from '@keryx-kit/domain'

/**
 * Scuffwell's Puddle sale post (`apps/demo-shoe/posts`), without its image, signed with a
 * local demo author key. Not signed by Scuffwell's production key.
 */
export const DEMO_ITEM: Item = {
  content_html:
    '<p>It has rained in Felgueiras for nine days straight, so we are calling it.</p>\n<p>Until <strong>Monday 16 November</strong>, every pair of <strong>Puddle</strong> boots is <strong>20% off</strong> with the code:</p>\n<p><strong>PUDDLE20</strong></p>\n<p>That&#39;s €132 instead of €165, in Olive and the new Oxblood. The code works at checkout on shoe.roguedave.codes and at our Karlín pop-up.</p>\n<p>A few honest details:</p>\n<ul>\n<li>One code per order, and it doesn&#39;t stack with other discounts.</li>\n<li>Free returns within 60 days still apply.</li>\n<li>We will never send you a discount code that asks you to log in, pay a fee or &quot;verify&quot; anything. If you see one, it isn&#39;t us.</li>\n</ul>\n<p>Go find a puddle.</p>\n',
  date_published: '2026-10-26T09:00:00Z',
  id: 'puddle-season-sale',
  language: 'en',
  sig: [
    {
      keyid: 'c68e44538b010c0a897e0752e051f90b8f86bae75919a4d8881260213090f285',
      sig: 'qwGM5FlDPNS83CdkjziooBTGAdDW7MILGBIV_kK-yXT6QcyOazFjRV8tvOwr1sBGyqUNVEWha_1j0CiGu-TjDw',
    },
  ],
  tags: ['sale', 'puddle'],
  title: 'Puddle season: 20% off every pair of boots',
}

export const DEMO_AUTHOR = {
  keyid: 'c68e44538b010c0a897e0752e051f90b8f86bae75919a4d8881260213090f285',
  publicKey: 'b5aa23c14b4900e2315faafe31ee9501e23590477a0cdb24d1b725f6a98ea2f1',
} as const
