#!/bin/sh

usage() {
    echo "do.sh {major | minor | patch}"
    exit
}

. .release/base.sh || exit

case "$1" in
    "major" )
    ;;
    "minor" )
    ;;
    "patch" )
    ;;
    *)
    usage
    ;;
esac

NEW_VERSION=$(npm --no-git-tag-version version "$1")

YMD=$(date "+%Y-%m-%d")
# echo "Preparing $NEW_VERSION - $YMD"

if branch_is_master; then
    git checkout -b "release-${NEW_VERSION}"
fi

update_changes() {
    tee .release/new.txt <<EO_CHANGE


#### ${NEW_VERSION//v} - $YMD

-
-
EO_CHANGE

    sed -i '' -e "/#### N.N.N.*$/r .release/new.txt" "$CHANGELOG"
    rm .release/new.txt

    if command -v open; then open "$CHANGELOG"; fi

    echo
    echo "AFTER editing $CHANGELOG, run: .release/push.sh"
}

find_changelog
update_changes
