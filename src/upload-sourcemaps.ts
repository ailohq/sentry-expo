import spawnAsync from '@expo/spawn-async';
import path from 'path';
import rimraf from 'rimraf';
import mkdirp from 'mkdirp';
import fs from 'fs';
import sentryCliBinary from '@sentry/cli';

type Options = {
  log: (message: string) => void;
  projectRoot: string;
  androidBundle: string;
  androidSourceMap: string;
  iosManifest: { revisionId: string };
  iosSourceMap: string;
  iosBundle: string;
  config?: {
    organization: string;
    project: string;
    authToken: string;
    url: string;
    useGlobalSentryCli: boolean;
  };
};

export default async (options: Options) => {
  let {
    config,
    log,
    iosBundle,
    iosSourceMap,
    iosManifest,
    androidBundle,
    androidSourceMap,
    projectRoot,
  } = options;

  const tmpdir = path.resolve(projectRoot, '.tmp', 'sentry');

  // revisionId is the same between the Android and IOS manifests, so
  // we just pick one and get on with it.
  const version = iosManifest.revisionId;

  rimraf.sync(tmpdir);
  mkdirp.sync(tmpdir);

  try {
    fs.writeFileSync(tmpdir + '/main.ios.bundle', iosBundle, 'utf-8');
    fs.writeFileSync(tmpdir + '/main.android.bundle', androidBundle, 'utf-8');
    fs.writeFileSync(tmpdir + '/main.ios.map', iosSourceMap, 'utf-8');
    fs.writeFileSync(tmpdir + '/main.android.map', androidSourceMap, 'utf-8');

    let organization, project, authToken, url, useGlobalSentryCli;
    if (!config) {
      log('No config found in app.json, falling back to environment variables...');
    } else {
      ({ organization, project, authToken, url, useGlobalSentryCli } = config);
    }

    const childProcessEnv = Object.assign({}, process.env, {
      SENTRY_ORG: organization || process.env.SENTRY_ORG,
      SENTRY_PROJECT: project || process.env.SENTRY_PROJECT,
      SENTRY_AUTH_TOKEN: authToken || process.env.SENTRY_AUTH_TOKEN,
      SENTRY_URL: url || process.env.SENTRY_URL || 'https://sentry.io/',
    });

    const sentryCliBinaryPath = useGlobalSentryCli ? 'sentry-cli' : sentryCliBinary.getPath();

    let output;
    let createReleaseResult = await spawnAsync(sentryCliBinaryPath, ['releases', 'new', version], {
      cwd: tmpdir,
      env: childProcessEnv,
    });

    output = createReleaseResult.stdout.toString();
    log(output);

    let uploadResult = await spawnAsync(
      sentryCliBinaryPath,
      [
        'releases',
        'files',
        version,
        'upload-sourcemaps',
        '.',
        '--ext',
        'bundle',
        '--ext',
        'map',
        '--rewrite',
      ],
      {
        cwd: tmpdir,
        env: childProcessEnv,
      }
    );

    output = uploadResult.stdout.toString();
    log(output);
  } catch (e) {
    log(messageForError(e));
    log(
      `Verify that your Sentry configuration in app.json is correct and refer to https://docs.expo.io/versions/latest/guides/using-sentry.html`
    );
  } finally {
    rimraf.sync(tmpdir);
  }
};

function messageForError(e: Error & { stderr?: string }) {
  let message = e.stderr ? e.stderr.replace(/^\s+|\s+$/g, '') : e.message;
  if (message) {
    if (message.indexOf('error: ') === 0) {
      message = message.replace('error: ', '');
    }
    return `Error uploading sourcemaps to Sentry: ${message}`;
  }

  return 'Error uploading sourcemaps to Sentry';
}
