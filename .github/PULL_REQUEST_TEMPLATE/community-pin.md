<!--
A pin PR moves the community shelf the studio ships: it changes deploy/community-pin.json and nothing else.
Open it with ?template=community-pin.md on the compare URL. Make the pin with:

  node tools/community-pull.js --pin <overdub-devices commit>

and paste what it prints below. The second person accepts it (two people to add a device, one to take one down).
A takedown pin merges at once and is reviewed after: overdub-devices' docs/TAKEDOWN.md.
-->

## The shelf

<!-- the summary community-pull.js --pin printed: "Shelf: overdub-devices@<old> → overdub-devices@<new>", then
Added, Changed and Taken down -->

**Added**
- 

**Changed**
- 

**Taken down**
- 

## Checks

- [ ] Only `deploy/community-pin.json` changes.
- [ ] The overdub-devices commit is on its `master` (not a branch that can be squashed or deleted).
- [ ] Each added or changed device's PR in overdub-devices was reviewed and merged by one person, who listened, read
      the code and read the scorecard (overdub-devices CONTRIBUTING, step 4).
- [ ] The index was rebuilt from that merge with a clean tree and `--checks` (the pull warns when `built.checks` is
      null).
- [ ] Takedown: the reason in `revoked.json` and the line in overdub-devices' CHANGELOG.md say the same thing.
- [ ] After the deploy: `node tools/prod-check.js`.
