import { currentRoot, type Repo, repoFiles, utf8 } from '@keryx-kit/domain'
import { joinPageHtml } from '@keryx-kit/join-kit'
import { zipSync } from 'fflate'

const readme = (origin: string) => `# Keryx join kit

Upload these files to ${origin} so that:

- \`${origin}/.well-known/keryx/root.json\` and every \`N.root.json\` next to it serve the
  files from this kit, byte for byte.
- \`${origin}/join\` serves \`join/index.html\`.

Required headers:

- \`Access-Control-Allow-Origin: *\` and \`Content-Type: application/json\` on
  \`/.well-known/keryx/*\` (the Keryx app fetches them from another origin).
- \`Referrer-Policy: no-referrer\` on \`/join\`.

Also redact the \`p\` query parameter of \`/join\` from your access logs: it lists the
channels a subscriber picked.

## nginx

    location /.well-known/keryx/ {
        default_type application/json;
        add_header Access-Control-Allow-Origin "*" always;
    }
    location = /join {
        try_files /join/index.html =404;
        add_header Referrer-Policy "no-referrer" always;
    }

    # log_format without the query string for /join:
    map $request_uri $keryx_loggable_uri {
        ~^/join\\?  /join;
        default     $request_uri;
    }

## Apache (.htaccess)

    <IfModule mod_headers.c>
      <If "%{REQUEST_URI} =~ m#^/\\.well-known/keryx/#">
        Header set Access-Control-Allow-Origin "*"
        Header set Content-Type "application/json"
      </If>
      <If "%{REQUEST_URI} =~ m#^/join#">
        Header set Referrer-Policy "no-referrer"
      </If>
    </IfModule>
    RewriteEngine On
    RewriteRule ^join$ /join/index.html [L]

## Cloudflare (Pages \`_headers\` file, or a Transform Rule with the same headers)

    /.well-known/keryx/*
      Access-Control-Allow-Origin: *
      Content-Type: application/json
    /join
      Referrer-Policy: no-referrer
    /join/*
      Referrer-Policy: no-referrer

Turn off Email Obfuscation and Rocket Loader for \`/join\`: they rewrite the page.

## Netlify (\`_headers\` file in the publish directory)

    /.well-known/keryx/*
      Access-Control-Allow-Origin: *
      Content-Type: application/json
    /join
      Referrer-Policy: no-referrer
    /join/*
      Referrer-Policy: no-referrer

When everything is in place, the console's domain check turns *Live*.
`

/** The zip an owner hands to their web admin (mvp-spec A3). */
export const buildJoinKit = (repo: Repo, origin: string): Uint8Array => {
  const files: Record<string, Uint8Array> = {}
  for (const [name, bytes] of Object.entries(repoFiles(repo).anchor)) {
    files[`.well-known/keryx/${name}`] = bytes
  }
  files['join/index.html'] = utf8(joinPageHtml)
  files['README.md'] = utf8(readme(origin))
  return zipSync(files, { mtime: new Date(currentRoot(repo).signed.expires) })
}
