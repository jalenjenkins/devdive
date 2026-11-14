'use strict';

// Curated topics the daily refill draws from before asking the model to
// invent new ones. Each must have many objectively verifiable answers that
// range from very common to very obscure.
//
// `truth` names a ground-truth source in lib/groundtruth.js. Answers that are
// not in that source are dropped without spending an LLM call.
const TOPICS = [
  { text: 'Name a CSS property', category: 'css' },
  { text: 'Name an HTML element', category: 'html' },
  { text: 'Name a Kubernetes resource kind', category: 'kubernetes' },
  { text: 'Name a Vim normal-mode command', category: 'vim' },
  { text: 'Name a regular expression feature or metacharacter', category: 'regex' },
  { text: 'Name a standard directory in the Linux filesystem hierarchy', category: 'linux' },
  { text: 'Name a TCP or UDP service that has a well-known port', category: 'networking' },
  { text: 'Name a Rust standard library trait', category: 'rust' },
  { text: 'Name a Go standard library package', category: 'go' },
  { text: 'Name a Python built-in function', category: 'python-builtins' },
  { text: 'Name a Python exception class', category: 'python-exceptions' },
  { text: 'Name a Java standard library collection class or interface', category: 'java' },
  { text: 'Name a SQL aggregate or scalar function', category: 'sql-functions' },
  { text: 'Name a Bash built-in command', category: 'bash' },
  { text: 'Name an npm CLI subcommand', category: 'npm' },
  { text: 'Name a TypeScript utility type', category: 'typescript' },
  { text: 'Name a data structure', category: 'data-structures' },
  { text: 'Name a graph algorithm', category: 'algorithms-graph' },
  { text: 'Name an HTTP request method', category: 'http-methods' },
  { text: 'Name a cryptographic hash function', category: 'crypto' },
  { text: 'Name a text editor or IDE', category: 'tools' },
  { text: 'Name a relational or NoSQL database system', category: 'databases' },
  { text: 'Name a version control system', category: 'vcs' },
  { text: 'Name a Linux system call', category: 'syscalls' },
  { text: 'Name a JavaScript built-in global object', category: 'javascript-globals' },
  { text: 'Name a C standard library header', category: 'c' },
  { text: 'Name an ASCII control character abbreviation (such as NUL or ESC)', category: 'ascii' },
  { text: 'Name a Unicode text encoding or character set', category: 'encodings' },
  { text: 'Name a git hook', category: 'git-hooks' },
  { text: 'Name a Dockerfile instruction', category: 'dockerfile' },
];

module.exports = { TOPICS };
