/**
 * Structural invariants this codebase must keep, checked by grep rather than by
 * discipline. Run with `npm run audit`.
 *
 * These are the things that were actually wrong at some point, or that would be silent
 * if they broke: a float creeping into money, two definitions of a price drifting apart,
 * an int4 cast capping a total, or a credential reaching a type a page can hand to a
 * client component.
 */
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.next', '.data', '.git'].includes(entry.name)) continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

const appFiles = [...walk('app'), ...walk('lib'), ...walk('components')]
const read = (file) => fs.readFileSync(file, 'utf8')
const rel = (file) => path.relative(root, file).replace(/\\/g, '/')

/** Every offending `file:line — text` for a pattern, across a file set. */
function findAll(files, pattern, skip = () => false) {
  const hits = []
  for (const file of files) {
    read(file)
      .split('\n')
      .forEach((line, index) => {
        if (pattern.test(line) && !skip(rel(file), line)) {
          hits.push(`${rel(file)}:${index + 1} — ${line.trim().slice(0, 110)}`)
        }
      })
  }
  return hits
}

/**
 * The balanced parenthesised expression ending just before `index`, so a cast can be
 * attributed to what it actually casts rather than to anything else on the line.
 */
function expressionBefore(line, index) {
  let depth = 0
  let i = index - 1
  while (i >= 0) {
    const ch = line[i]
    if (ch === ')') depth += 1
    else if (ch === '(') {
      depth -= 1
      if (depth === 0) {
        // include the function name in front of the opening paren
        let start = i - 1
        while (start >= 0 && /[\w.]/.test(line[start])) start -= 1
        return line.slice(start + 1, index)
      }
      if (depth < 0) return line.slice(i + 1, index)
    }
    i -= 1
  }
  return line.slice(0, index)
}

/** Entry points that are unauthenticated on purpose; each carries its own throttle. */
const PUBLIC_ACTIONS = new Set([
  'unlockWorkspace',    // the front door, throttled after 10 wrong passwords
  'setActingMember',    // requires an unlocked session cookie, validates the member
  'lockWorkspace',      // clears your own cookies
  'verifyPortalPin',    // the portal door, throttled after 5 wrong PINs
  'leavePortal',        // clears your own cookie
])

const checks = [
  {
    name: 'Money is never a float: no numeric, real or double column',
    why: 'This is a billing product. Exactness is the feature.',
    hits: () => findAll([path.join('lib', 'db', 'schema.ts')], /\b(numeric|real|doublePrecision)\(/),
  },
  {
    name: 'No parseFloat anywhere in application code',
    why: 'Money and durations are parsed into integer cents and minutes, never floats.',
    hits: () => findAll(appFiles, /parseFloat/),
  },
  {
    name: 'Money and minutes aggregates are ::bigint, never ::int',
    why: '::int caps a total at 2,147,483,647 cents — 21.47M — which a real yearly figure passes.',
    // A line can legitimately hold both `sum(x)::bigint` and `count(y)::int`, so this
    // walks back from each `::int` to the balanced expression it actually casts and only
    // flags the ones that cast a sum.
    hits: () => {
      const problems = []
      for (const file of appFiles) {
        read(file)
          .split('\n')
          .forEach((line, index) => {
            for (const match of line.matchAll(/::int\b/g)) {
              const castExpression = expressionBefore(line, match.index)
              if (/\bsum\s*\(/.test(castExpression)) {
                problems.push(`${rel(file)}:${index + 1} — ${castExpression.slice(-90)}::int`)
              }
            }
          })
      }
      return problems
    },
  },
  {
    name: 'The price of an hour is defined exactly once per language',
    why: 'Two drifting implementations of a price is the worst kind of bug: quiet and financial.',
    hits: () => {
      const problems = []
      const ts = (read(path.join('lib', 'domain', 'money.ts')).match(/export function amountCents/g) ?? []).length
      const sq = (read(path.join('lib', 'db', 'sql-money.ts')).match(/export function priceCents/g) ?? []).length
      if (ts !== 1) problems.push(`lib/domain/money.ts — expected 1 amountCents, found ${ts}`)
      if (sq !== 1) problems.push(`lib/db/sql-money.ts — expected 1 priceCents, found ${sq}`)
      return problems
    },
  },
  {
    name: 'No ad-hoc price expression outside the shared definition',
    why: 'Every aggregate must go through priceCents() so the parity test actually covers it.',
    hits: () =>
      findAll(appFiles, /rate_cents\s*\/\s*60/, (file) => file === 'lib/db/sql-money.ts' || file === 'lib/db/schema.ts'),
  },
  {
    name: 'No page-facing type holds a full member row',
    why: 'pinHash, pinSalt and portalToken are credentials. Pages only ever hold PublicMember.',
    hits: () =>
      findAll(
        appFiles.filter((f) => !rel(f).includes('capacity-context')),
        /:\s*Member\b/,
        (_file, line) => line.includes('toPublicMember') || line.includes('PublicMember'),
      ),
  },
  {
    name: 'No Date object crosses the data layer for a human-picked date',
    why: 'A timesheet day is a day. Converting it to an instant is how Monday becomes Sunday.',
    hits: () => findAll(walk(path.join('lib', 'db', 'queries')), /new Date\(/),
  },
  {
    name: 'Every server action authorizes inside its own body',
    why:
      "Every export of a 'use server' module is an endpoint the browser can call with " +
      'arbitrary arguments. A file-level import proves nothing; the guard has to be in ' +
      'the function.',
    hits: () =>
      serverActions().filter((action) => !action.guarded && !PUBLIC_ACTIONS.has(action.name))
        .map((action) => `${action.file} — ${action.name}() has no permission check`),
  },
  {
    name: 'No server action is a read that takes an id',
    why:
      'A read taking a memberId or projectId belongs in the query layer, which the ' +
      'browser cannot call. In an action it is an open data endpoint.',
    hits: () =>
      serverActions()
        .filter((action) => /^(list|get|find|fetch|read)/.test(action.name))
        .filter((action) => !action.guarded)
        .map((action) => `${action.file} — ${action.name}() reads without a guard`),
  },
  {
    name: 'Every server action validates its input with Zod',
    why: 'Validation at the boundary is the first of the three gates a mutation passes.',
    hits: () =>
      serverActions()
        // A zero-argument action has no input to validate.
        .filter((action) => action.writes && !action.validated && action.hasArguments)
        .map((action) => `${action.file} — ${action.name}() writes without validating`),
  },
  {
    name: 'The workspace has exactly one definition of today',
    why:
      'A calendar date derived from `new Date()` is the *browser* or *server* day, not ' +
      "the workspace's. Two definitions disagree by a day for anyone whose zone is not " +
      'the host\'s. Take the day from the request context and pass it down.',
    hits: () =>
      findAll(
        appFiles,
        /new Date\(\)\.toISOString\(\)\.slice|new Date\(\)\.(getFullYear|getMonth|getDate)\(/,
        (file) => file === 'lib/domain/dates.ts',
      ),
  },
  {
    name: 'today() is never asked without a time zone',
    why:
      'Without a zone today() answers in the host calendar, which on Vercel is UTC. ' +
      'Pages read ctx.today and queries take asOf; nothing else should be asking.',
    hits: () =>
      findAll(
        appFiles,
        /\btoday\(\s*\)/,
        (file, line) => file === 'lib/domain/dates.ts' || isComment(line),
      ),
  },
  {
    name: 'No server component slots an element into a client component',
    why:
      "Radix's asChild slot needs a real element. One built in a server component reaches " +
      'it through the RSC payload, and arrives as a lazy reference once that payload is big ' +
      'enough to be split into chunks — so the page 500s only on the wider data sets.',
    hits: () => slotHazards(),
  },
]

/** A line that only talks about code, so a pattern inside it is prose, not a call. */
function isComment(line) {
  return /^\s*(\/\/|\*|\/\*)/.test(line)
}

/** The `components/ui/*` modules that are client components, by import specifier. */
function clientUiModules() {
  const found = new Set()
  for (const file of walk(path.join('components', 'ui'))) {
    if (/^\s*['"]use client['"]/.test(read(file))) {
      found.add('@/' + rel(file).replace(/\.tsx?$/, ''))
    }
  }
  return found
}

/**
 * Every `asChild` written in a server component against a client-component module.
 * The element handed to the slot is then built on the wrong side of the RSC boundary.
 */
function slotHazards() {
  const clientModules = clientUiModules()
  const hits = []
  for (const file of appFiles) {
    if (!file.endsWith('.tsx')) continue
    const source = read(file)
    if (!source.includes('asChild')) continue
    if (/^\s*['"]use client['"]/.test(source)) continue
    const imported = [...source.matchAll(/from '(@\/components\/ui\/[\w-]+)'/g)].map((m) => m[1])
    const offending = imported.filter((specifier) => clientModules.has(specifier))
    if (offending.length > 0) {
      hits.push(`${rel(file)} — asChild in a server component, against ${offending.join(', ')}`)
    }
  }
  return hits
}

/** Every exported function of every 'use server' module, with what its body does. */
function serverActions() {
  const found = []
  for (const file of walk(path.join('lib', 'actions'))) {
    const source = read(file)
    if (!source.includes("'use server'")) continue
    const matches = [...source.matchAll(/export async function (\w+)\(/g)]
    matches.forEach((match, i) => {
      const start = match.index
      const end = i + 1 < matches.length ? matches[i + 1].index : source.length
      const body = source.slice(start, end)
      found.push({
        file: rel(file),
        name: match[1],
        guarded: /requireCapability|requirePortalMember|getWorkspaceContext|verifySecret|getSettings/.test(body),
        // readId() is the shared uuid guard for bare id arguments.
        validated: /safeParse|readId\(|\bz\./.test(body),
        writes: /\.(insert|update|delete)\(|tx\.execute/.test(body),
        hasArguments: !new RegExp(`function ${match[1]}\\(\\s*\\)`).test(source),
      })
    })
  }
  return found
}

let failed = 0
console.log('\nStructural audit\n')
for (const check of checks) {
  const hits = check.hits()
  if (hits.length === 0) {
    console.log(`  PASS  ${check.name}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${check.name}`)
    console.log(`        ${check.why}`)
    for (const hit of hits.slice(0, 8)) console.log(`        ${hit}`)
    if (hits.length > 8) console.log(`        …and ${hits.length - 8} more`)
  }
}
console.log(
  failed === 0
    ? `\n${checks.length} invariants hold.\n`
    : `\n${failed} of ${checks.length} invariants broken.\n`,
)
process.exit(failed === 0 ? 0 : 1)
