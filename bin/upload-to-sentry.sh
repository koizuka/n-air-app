#!/bin/bash
set -e # exit when error

export SENTRY_ORG="n-air-app"

export SENTRY_CLI="$(dirname $0)/node_modules/\@sentry/cli/bin/sentry-cli"

BASEDIR=$(git rev-parse --show-cdup)

export SENTRY_PROJECT=$(jq -r .name < ${BASEDIR}package.json)
RELEASE=$(jq -r .version < ${BASEDIR}package.json)
echo Release: $RELEASE

# inject debug_id to sourcemap (for sentry-cli 2.17+)
cp ${BASEDIR}main.js ${BASEDIR}bundles/
$SENTRY_CLI sourcemaps inject ${BASEDIR}bundles/

$SENTRY_CLI releases new $RELEASE
$SENTRY_CLI sourcemaps upload --release=$RELEASE ${BASEDIR}bundles/ --validate 
$SENTRY_CLI releases finalize $RELEASE

