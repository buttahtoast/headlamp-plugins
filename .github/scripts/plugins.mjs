import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const [command, argument, destination] = process.argv.slice(2);
const readJSON = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'));
const settings = readJSON('.github/plugin-settings.json');
const plugins = fs
  .readdirSync(root, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      fs.existsSync(path.join(entry.name, 'package.json'))
  )
  .flatMap((entry) => {
    const pkg = readJSON(path.join(entry.name, 'package.json'));
    if (!pkg.devDependencies?.['@kinvolk/headlamp-plugin']) return [];
    const catalogName = pkg.name.split('/').at(-1);
    assert.match(entry.name, /^[a-z0-9-]+$/);
    assert.match(catalogName, /^[a-z0-9-]+$/);
    return [
      {
        directory: entry.name,
        name: pkg.name,
        catalogName,
        installDirectory: settings[entry.name]?.installDirectory || catalogName,
      },
    ];
  })
  .sort((a, b) => a.directory.localeCompare(b.directory));
assert.ok(plugins.length, 'No Headlamp plugins found');

function output(values) {
  for (const [key, value] of Object.entries(values)) {
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
  }
}

function releaseVersion(tag) {
  const id = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const match = tag?.match(
    new RegExp(
      '^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-' +
        id +
        '(?:\\.' +
        id +
        ')*)?$'
    )
  );
  assert.ok(
    match && match[0] === tag && tag.length <= 120,
    'Expected vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.1'
  );
  return tag.slice(1);
}

if (command === 'matrix') {
  const version = argument ? releaseVersion(argument) : '';
  output({
    matrix: JSON.stringify({ include: plugins }),
    version,
    prerelease: version.includes('-'),
  });
  console.log(plugins.map((plugin) => plugin.directory).join('\n'));
} else if (command === 'prepare') {
  const version = releaseVersion(argument);
  const directories = new Set(
    plugins.map((plugin) => path.join(root, plugin.directory))
  );
  // Stamp all local packages before npm ci resolves Flux's file:../ssa dependency.
  for (const plugin of plugins) {
    const directory = path.join(root, plugin.directory);
    const pkg = readJSON(path.join(directory, 'package.json'));
    const lock = readJSON(path.join(directory, 'package-lock.json'));
    pkg.version = lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
    for (const [name, spec] of Object.entries({
      ...pkg.devDependencies,
      ...pkg.dependencies,
    })) {
      if (!spec.startsWith('file:')) continue;
      const target = path.resolve(directory, spec.slice(5));
      assert.ok(
        directories.has(target),
        'Local dependency must be another release plugin'
      );
      for (const key of [
        'node_modules/' + name,
        path.relative(directory, target).split(path.sep).join('/'),
      ]) {
        if (lock.packages?.[key] && !lock.packages[key].link)
          lock.packages[key].version = version;
      }
    }
    for (const [filename, data] of [
      ['package.json', pkg],
      ['package-lock.json', lock],
    ]) {
      const target = path.join(directory, filename);
      const indent = fs.readFileSync(target, 'utf8').includes('\n\t')
        ? '\t'
        : 2;
      fs.writeFileSync(target, JSON.stringify(data, null, indent) + '\n');
    }
    const template = path.join(directory, 'artifacthub.template.yml');
    fs.writeFileSync(
      template,
      fs
        .readFileSync(template, 'utf8')
        .replace(/^prerelease:.*$/m, 'prerelease: ' + version.includes('-'))
    );
    fs.copyFileSync(
      'artifacthub-repo.yml',
      path.join(directory, 'artifacthub-repo.yml')
    );
  }
} else if (command === 'package') {
  const plugin = plugins.find((plugin) => plugin.directory === argument);
  assert.ok(plugin, 'Unknown plugin');
  const directory = path.join(root, plugin.directory);
  const outputDirectory = path.resolve(destination);
  const imagePlugins = path.join(outputDirectory, 'context/plugins');
  fs.mkdirSync(imagePlugins, { recursive: true });
  const cli = path.join(
    directory,
    'node_modules/@kinvolk/headlamp-plugin/bin/headlamp-plugin.js'
  );
  for (const args of [
    ['package', directory, outputDirectory],
    ['extract', directory, imagePlugins],
  ]) {
    execFileSync(process.execPath, [cli, ...args], {
      cwd: directory,
      stdio: 'inherit',
    });
  }
  if (plugin.directory !== plugin.installDirectory) {
    fs.renameSync(
      path.join(imagePlugins, plugin.directory),
      path.join(imagePlugins, plugin.installDirectory)
    );
  }
} else if (command === 'image') {
  const version = releaseVersion(process.env.GITHUB_REF_NAME);
  assert.ok(
    plugins.some((plugin) => plugin.directory === argument),
    'Unknown plugin'
  );
  const image =
    'ghcr.io/' + process.env.GITHUB_REPOSITORY.toLowerCase() + '/' + argument;
  const tags = [
    version,
    process.env.GITHUB_REF_NAME,
    'sha-' + process.env.GITHUB_SHA,
  ];
  if (!version.includes('-')) tags.push('latest');
  output({ image, tags: tags.map((tag) => image + ':' + tag).join(',') });
} else {
  throw new Error('Unknown command: ' + command);
}
