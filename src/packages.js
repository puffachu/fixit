'use strict';

// Import name -> PyPI distribution name. `pip install cv2` fails; the package
// is `opencv-python`. Only unambiguous, well-known mismatches belong here.
const PYTHON_PACKAGES = {
  cv2: 'opencv-python',
  yaml: 'PyYAML',
  sklearn: 'scikit-learn',
  PIL: 'Pillow',
  bs4: 'beautifulsoup4',
  dotenv: 'python-dotenv',
  serial: 'pyserial',
  OpenSSL: 'pyOpenSSL',
  Crypto: 'pycryptodome',
  dateutil: 'python-dateutil',
  jwt: 'PyJWT',
  psycopg2: 'psycopg2-binary',
  google: 'google-api-python-client',
  attr: 'attrs',
  pkg_resources: 'setuptools',
};

// Missing binary -> the package that provides it, per manager. Used only when a
// command genuinely is not installed and is not a typo of something present.
const BINARY_PACKAGES = {
  htop: { apt: 'htop', brew: 'htop' },
  jq: { apt: 'jq', brew: 'jq' },
  rg: { apt: 'ripgrep', brew: 'ripgrep' },
  fd: { apt: 'fd-find', brew: 'fd' },
  tree: { apt: 'tree', brew: 'tree' },
  unzip: { apt: 'unzip', brew: 'unzip' },
  curl: { apt: 'curl', brew: 'curl' },
  wget: { apt: 'wget', brew: 'wget' },
  git: { apt: 'git', brew: 'git' },
  make: { apt: 'build-essential', brew: 'make' },
  gcc: { apt: 'build-essential', brew: 'gcc' },
  docker: { apt: 'docker.io', brew: 'docker' },
  pip: { apt: 'python3-pip', brew: 'python' },
  node: { apt: 'nodejs', brew: 'node' },
  psql: { apt: 'postgresql-client', brew: 'libpq' },
  convert: { apt: 'imagemagick', brew: 'imagemagick' },
  ffmpeg: { apt: 'ffmpeg', brew: 'ffmpeg' },
  lsof: { apt: 'lsof', brew: 'lsof' },
  netstat: { apt: 'net-tools', brew: 'net-tools' },
  dig: { apt: 'dnsutils', brew: 'bind' },
  tmux: { apt: 'tmux', brew: 'tmux' },
  zip: { apt: 'zip', brew: 'zip' },
};

function pythonPackageFor(moduleName) {
  const top = String(moduleName || '').split('.')[0];
  return PYTHON_PACKAGES[top] || top;
}

// Install command for a missing binary, or null when we don't know the package.
function installCommandFor(bin, platform) {
  const entry = BINARY_PACKAGES[bin];
  if (!entry) return null;
  const { binExists } = require('./bins');
  if (platform === 'darwin' || (binExists('brew') && !binExists('apt-get'))) {
    return entry.brew ? `brew install ${entry.brew}` : null;
  }
  if (binExists('apt-get') || binExists('apt')) {
    return entry.apt ? `sudo apt install ${entry.apt}` : null;
  }
  return null;
}

module.exports = { PYTHON_PACKAGES, BINARY_PACKAGES, pythonPackageFor, installCommandFor };
