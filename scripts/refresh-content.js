"use strict";

// No LLM calls. Import factual identifiers from pinned MDN data, the local
// runtimes, Git's command reference, and IANA's public protocol registries.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { builtinModules } = require("node:module");
const os = require("node:os");
const { norm } = require("../lib/matcher");
const editorial = require("../data/editorial-ranks.json");
const root = path.resolve(__dirname, "..");

function csv(text) {
  const rows = [];
  let row = [],
    value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  const keys = rows.shift();
  return rows.map((values) =>
    Object.fromEntries(keys.map((key, i) => [key, values[i] || ""])),
  );
}

async function download(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: {
      "user-agent":
        "Downstack content importer (+https://github.com/jalenjenkins/devdive)",
    },
  });
  if (!response.ok)
    throw new Error(
      "Source download failed: " + url + " (" + response.status + ")",
    );
  return response.text();
}

function allowed(entry) {
  const status = entry?.__compat?.status;
  return (
    status?.standard_track === true &&
    !status.deprecated &&
    !status.experimental
  );
}

async function refresh() {
  if (process.platform !== "linux")
    throw new Error(
      "Refresh on Linux (CI or WSL) to preserve Linux snapshot questions.",
    );
  const bcd = require("@mdn/browser-compat-data");
  const python = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        `import sys, json, keyword, builtins, inspect, importlib
modules = {}
for name in ['math','itertools','functools','collections','statistics','operator','datetime']:
 m = importlib.import_module(name)
 modules[name] = sorted(n for n in getattr(m, '__all__', dir(m)) if not n.startswith('_') and getattr(m, n, None) is not None)
print(json.dumps({'version':sys.version.split()[0], 'modules':sorted(n for n in sys.stdlib_module_names if not n.startswith('_')), 'keywords':keyword.kwlist, 'exceptions':sorted(n for n in dir(builtins) if isinstance(getattr(builtins,n),type) and issubclass(getattr(builtins,n),BaseException)), 'builtins':sorted(n for n in dir(builtins) if not n.startswith('_') and (inspect.isbuiltin(getattr(builtins,n)) or isinstance(getattr(builtins,n),type))), 'members':modules}))`,
      ],
      { encoding: "utf8", timeout: 15000 },
    ),
  );
  const gitVersion = execFileSync("git", ["--version"], {
    encoding: "utf8",
  }).trim();
  const git = execFileSync("git", ["--list-cmds=main,nohelpers"], {
    encoding: "utf8",
  })
    .trim()
    .split(/\s+/);
  const statusUrl =
    "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv";
  const fieldUrl =
    "https://www.iana.org/assignments/http-fields/field-names.csv";
  const [statusText, fieldText] = await Promise.all([
    download(statusUrl),
    download(fieldUrl),
  ]);
  const statuses = csv(statusText).filter(
    (r) =>
      /^\d{3}$/.test(r.Value) &&
      !/unassigned|unused|reserved/i.test(r.Description),
  );
  const fields = csv(fieldText).filter(
    (r) =>
      r.Status === "permanent" &&
      /^[A-Za-z][A-Za-z0-9-]*$/.test(r["Field Name"]),
  );
  const sources = [
    {
      id: "mdn-bcd",
      name: "MDN Browser Compatibility Data",
      version: bcd.__meta.version,
      url: "https://github.com/mdn/browser-compat-data",
      license: "CC0-1.0",
      licenseUrl:
        "https://github.com/mdn/browser-compat-data/blob/main/LICENSE",
    },
    {
      id: "python",
      name: "Python standard library and language runtime",
      version: python.version,
      url: "https://docs.python.org/3/library/",
      license: "PSF-2.0",
      licenseUrl: "https://docs.python.org/3/license.html",
    },
    {
      id: "node",
      name: "Node.js public runtime identifiers",
      version: process.version,
      url: "https://nodejs.org/api/",
      license: "MIT",
      licenseUrl: "https://github.com/nodejs/node/blob/main/LICENSE",
    },
    {
      id: "git",
      name: "Git command reference",
      version: gitVersion,
      url: "https://git-scm.com/docs/git",
      license: "Identifier facts; Git source is GPL-2.0",
      licenseUrl: "https://github.com/git/git/blob/master/COPYING",
    },
    {
      id: "iana-status",
      name: "IANA HTTP Status Code Registry",
      version: crypto.createHash("sha256").update(statusText).digest("hex"),
      url: statusUrl,
      license: "CC0-1.0 protocol registry data",
      licenseUrl: "https://www.iana.org/help/licensing-terms",
    },
    {
      id: "iana-fields",
      name: "IANA HTTP Field Name Registry",
      version: crypto.createHash("sha256").update(fieldText).digest("hex"),
      url: fieldUrl,
      license: "CC0-1.0 protocol registry data",
      licenseUrl: "https://www.iana.org/help/licensing-terms",
    },
  ];
  const tierIndex = new Map();
  for (const [tier, names] of Object.entries(editorial.tiers))
    for (const name of names) tierIndex.set(norm(name), Number(tier));
  const prompts = [];
  const seenSets = new Set();
  function add(id, text, category, sourceId, entries) {
    const unique = new Map();
    for (const item of entries) {
      const value = typeof item === "string" ? { canonical: item } : item;
      const key = norm(value.canonical);
      if (!key || value.canonical.length > 80 || unique.has(key)) continue;
      unique.set(key, value);
    }
    if (unique.size < 8) return;
    const names = [...unique.values()].sort((a, b) =>
      a.canonical.localeCompare(b.canonical, "en"),
    );
    const signature = names.map((v) => norm(v.canonical)).join("|");
    if (seenSets.has(signature)) return;
    seenSets.add(signature);
    const owners = new Set(unique.keys());
    const answers = names.map((v) => {
      const base = v.canonical
        .split(".")
        .at(-1)
        .replace(/^:+|^@/, "");
      const tier =
        tierIndex.get(norm(v.canonical)) || tierIndex.get(norm(base)) || 3;
      const aliases = [...new Set(v.aliases || [])].filter(
        (a) =>
          norm(a) && (!owners.has(norm(a)) || norm(a) === norm(v.canonical)),
      );
      for (const alias of aliases) owners.add(norm(alias));
      return {
        canonical: v.canonical,
        aliases,
        tier,
        ...(tier === 6 ? { pin: true } : {}),
      };
    });
    const source = sources.find((s) => s.id === sourceId);
    prompts.push({
      id,
      text,
      category,
      sourceId,
      status: "ready",
      source: "reference-data",
      fact: {
        css: "Vendor-prefixed, experimental and deprecated CSS entries are excluded.",
        html: "This bank uses standard, non-deprecated HTML names. Global attributes also count for element-attribute prompts.",
        javascript:
          "Answer with the member or built-in name. Matching ignores case.",
        webapi:
          "Use a standard interface or event name, as requested by the prompt.",
        python: "Accepted names come from Python " + python.version + ".",
        node: "The node: prefix is optional.",
        linux:
          "Signal and errno names vary across operating systems; this bank uses Linux identifiers.",
        git: "The git prefix is optional.",
        http: "This bank uses assigned HTTP codes and permanent HTTP field names.",
      }[category],
      answers,
    });
  }
  const keys = (obj) =>
    Object.entries(obj)
      .filter(([key, entry]) => !key.startsWith("__") && allowed(entry))
      .map(([key]) => key);
  const css = keys(bcd.css.properties).filter((s) => !s.startsWith("-"));
  add(
    "css-properties",
    "Name a standard, non-deprecated CSS property.",
    "css",
    "mdn-bcd",
    css,
  );
  for (const word of [
    "border",
    "background",
    "font",
    "text",
    "grid",
    "animation",
    "transition",
    "scroll",
    "padding",
    "margin",
    "column",
    "mask",
  ]) {
    add(
      "css-" + word,
      "Name a standard CSS property containing “" + word + "”.",
      "css",
      "mdn-bcd",
      css.filter((s) => s.includes(word)),
    );
  }
  const selectors = Object.entries(bcd.css.selectors)
    .filter(([, v]) => allowed(v))
    .map(([key, v]) => {
      const description = v.__compat.description || "";
      const spelling = /<code>([^<]+)<\/code>/.exec(description)?.[1] || key;
      return {
        canonical: spelling.replace(/\(.*\)/, ""),
        aliases: [key, key.replaceAll("_", "-")],
      };
    })
    .filter((v) => /^:{1,2}[a-z-]+$/.test(v.canonical));
  add(
    "css-pseudo",
    "Name a standard CSS pseudo-class or pseudo-element.",
    "css",
    "mdn-bcd",
    selectors,
  );
  add(
    "css-at-rules",
    "Name a standard CSS at-rule.",
    "css",
    "mdn-bcd",
    keys(bcd.css["at-rules"]).map((k) => ({
      canonical: "@" + k,
      aliases: [k],
    })),
  );
  const html = keys(bcd.html.elements).filter((s) =>
    /^[a-z][a-z0-9]*$/.test(s),
  );
  const globals = keys(bcd.html.global_attributes).filter((s) =>
    /^[a-z][a-z0-9-]*$/.test(s),
  );
  add(
    "html-elements",
    "Name a standard, non-deprecated HTML element.",
    "html",
    "mdn-bcd",
    html.map((k) => ({ canonical: k, aliases: ["<" + k + ">"] })),
  );
  add(
    "html-global-attributes",
    "Name a standard HTML global attribute.",
    "html",
    "mdn-bcd",
    globals,
  );
  for (const element of [
    "input",
    "button",
    "form",
    "a",
    "img",
    "video",
    "audio",
    "iframe",
    "script",
    "link",
    "select",
    "textarea",
  ]) {
    const own = keys(bcd.html.elements[element] || {}).filter((s) =>
      /^[a-z][a-z0-9-]*$/.test(s),
    );
    add(
      "html-" + element + "-attributes",
      "Name a standard attribute usable on an HTML " + element + " element.",
      "html",
      "mdn-bcd",
      [...globals, ...own],
    );
  }
  const builtins = keys(bcd.javascript.builtins).filter((s) =>
    /^[A-Za-z][A-Za-z0-9]*$/.test(s),
  );
  add(
    "js-globals",
    "Name a standard JavaScript global built-in.",
    "javascript",
    "mdn-bcd",
    builtins,
  );
  for (const type of [
    "Array",
    "String",
    "Object",
    "Number",
    "Math",
    "Date",
    "Reflect",
    "Atomics",
    "Promise",
    "Map",
    "Set",
    "RegExp",
    "ArrayBuffer",
    "DataView",
    "Intl",
    "TypedArray",
  ]) {
    add(
      "js-" + type.toLowerCase() + "-members",
      "Name a standard JavaScript " + type + " method or property.",
      "javascript",
      "mdn-bcd",
      keys(bcd.javascript.builtins[type] || {}).filter(
        (s) => s !== type && /^[a-zA-Z][a-zA-Z0-9]*$/.test(s),
      ),
    );
  }
  const interfaces = keys(bcd.api).filter((s) => /^[A-Z][A-Za-z0-9]+$/.test(s));
  add(
    "web-interfaces",
    "Name a standard Web API interface.",
    "webapi",
    "mdn-bcd",
    interfaces,
  );
  for (const [id, name, predicate] of [
    ["events", "event interface", (s) => s.endsWith("Event")],
    ["html", "HTML element interface", (s) => /^HTML.*Element$/.test(s)],
    ["svg", "SVG element interface", (s) => /^SVG.*Element$/.test(s)],
    [
      "audio",
      "audio node interface",
      (s) =>
        s.endsWith("Node") &&
        /Audio|Oscillator|Gain|Biquad|Panner|WaveShaper|Convolver|Analyser|Dynamics|Channel|Delay/.test(
          s,
        ),
    ],
  ])
    add(
      "web-" + id + "-interfaces",
      "Name a standard Web API " + name + ".",
      "webapi",
      "mdn-bcd",
      interfaces.filter(predicate),
    );
  const events = new Set();
  for (const api of Object.values(bcd.api))
    for (const key of keys(api))
      if (key.endsWith("_event") && /^[a-z]+_event$/.test(key))
        events.add(key.slice(0, -6));
  add(
    "web-event-names",
    "Name a standard Web API event name.",
    "webapi",
    "mdn-bcd",
    [...events],
  );
  add(
    "python-modules",
    "Name a public Python standard-library module.",
    "python",
    "python",
    python.modules,
  );
  add(
    "python-keywords",
    "Name a Python reserved keyword.",
    "python",
    "python",
    python.keywords,
  );
  add(
    "python-exceptions",
    "Name a Python built-in exception or warning class.",
    "python",
    "python",
    python.exceptions,
  );
  add(
    "python-builtins",
    "Name a Python built-in function or type.",
    "python",
    "python",
    python.builtins,
  );
  for (const [module, members] of Object.entries(python.members))
    add(
      "python-" + module + "-members",
      "Name a public member of Python’s " + module + " module.",
      "python",
      "python",
      members.map((s) => ({ canonical: s, aliases: [module + "." + s] })),
    );
  add(
    "node-modules",
    "Name a public Node.js built-in module.",
    "node",
    "node",
    builtinModules
      .filter((s) => !s.startsWith("_"))
      .map((s) => ({ canonical: s.replace(/^node:/, ""), aliases: [s] })),
  );
  add(
    "linux-signals",
    "Name a Unix signal available on Linux.",
    "linux",
    "node",
    Object.keys(os.constants.signals).map((s) => ({
      canonical: s,
      aliases: [s.replace(/^SIG/, "")],
    })),
  );
  add(
    "linux-errno",
    "Name a Linux errno constant.",
    "linux",
    "node",
    Object.keys(os.constants.errno),
  );
  add(
    "git-commands",
    "Name a Git command from its command reference.",
    "git",
    "git",
    git,
  );
  const statusEntries = statuses.map((r) => ({
    canonical: r.Value,
    aliases: [r.Description],
  }));
  add(
    "http-status",
    "Name an assigned HTTP status code.",
    "http",
    "iana-status",
    statusEntries,
  );
  add(
    "http-client-error",
    "Name an assigned 4xx HTTP status code.",
    "http",
    "iana-status",
    statusEntries.filter((r) => r.canonical.startsWith("4")),
  );
  add(
    "http-server-error",
    "Name an assigned 5xx HTTP status code.",
    "http",
    "iana-status",
    statusEntries.filter((r) => r.canonical.startsWith("5")),
  );
  add(
    "http-fields",
    "Name a permanent HTTP field name.",
    "http",
    "iana-fields",
    fields.map((r) => r["Field Name"]),
  );
  add(
    "http-content-fields",
    "Name a permanent HTTP field starting with Content-.",
    "http",
    "iana-fields",
    fields.map((r) => r["Field Name"]).filter((s) => /^Content-/i.test(s)),
  );

  const version = crypto
    .createHash("sha256")
    .update(JSON.stringify({ sources, prompts }))
    .digest("hex")
    .slice(0, 24);
  const catalog = {
    schemaVersion: 1,
    version,
    generatedAt: new Date().toISOString(),
    rarityPolicy: editorial.description,
    sources,
    prompts,
  };
  const { validateCatalog } = require("../lib/catalog");
  validateCatalog(catalog);
  const destination = path.join(root, "data", "catalog.json");
  if (
    fs.existsSync(destination) &&
    JSON.parse(fs.readFileSync(destination, "utf8")).version === version
  ) {
    console.log("Catalog unchanged: " + version);
    return;
  }
  fs.writeFileSync(
    destination + ".tmp",
    JSON.stringify(catalog, null, 2) + "\n",
  );
  fs.renameSync(destination + ".tmp", destination);
  console.log(
    JSON.stringify(
      {
        version,
        prompts: prompts.length,
        answerEntries: prompts.reduce((n, p) => n + p.answers.length, 0),
        categories: [...new Set(prompts.map((p) => p.category))],
      },
      null,
      2,
    ),
  );
}

if (require.main === module)
  refresh().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { csv, allowed, refresh };
