import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const packagePath = new URL('../package.json', import.meta.url);
const packageLockPath = new URL('../package-lock.json', import.meta.url);
const versionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const getHeadVersion = () => {
  try {
    const headPackage = execFileSync('git', ['show', 'HEAD:package.json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });

    return JSON.parse(headPackage).version;
  } catch {
    return null;
  }
};

const getNextPatchVersion = (version) => {
  const match = versionPattern.exec(version);

  if (!match) {
    throw new Error(`Версія "${version}" не відповідає формату major.minor.patch.`);
  }

  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
};

const packageJson = await readJson(packagePath);
const headVersion = getHeadVersion();

if (headVersion === null) {
  process.exit(0);
}

const nextVersion = getNextPatchVersion(headVersion);

if (packageJson.version !== headVersion && packageJson.version !== nextVersion) {
  throw new Error(
    `Очікувалася версія ${headVersion} або ${nextVersion}, отримано ${packageJson.version}.`
  );
}

if (packageJson.version === nextVersion) {
  process.exit(0);
}

const packageLock = await readJson(packageLockPath);

packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;

await Promise.all([
  writeJson(packagePath, packageJson),
  writeJson(packageLockPath, packageLock)
]);

console.log(`Версію додатку оновлено: ${headVersion} → ${nextVersion}`);
