#!/bin/sh

. .release/base.sh || exit

if branch_is_master; then
    echo "ERROR: run the release scripts in a feature branch! (not master)"
    exit
fi

VERSION=$(node -e 'console.log(require("./package.json").version)')

find_changelog

git add package.json
git add "$CHANGELOG"

git commit -m "Release v$VERSION"

git push --set-upstream origin "$(git branch --show-current)"

if command -v gh; then
    gh pr create
fi
