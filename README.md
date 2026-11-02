# Vite close-lifecycle reproductions

Independent Node ESM reproductions using official npm packages. There is no
framework, workspace patch, dependency modification, or private runtime API.
Tested with Node 24.22.1, npm 11.19.1, macOS 27.0.1 arm64, Vite 8.3.5,
Rolldown 1.2.16 and the official Darwin ARM64 binding 1.2.16.
The npm `latest` tags were 8.3.5 / 1.2.16 when checked on 2026-11-02.

```sh
npm ci
npm run repro:optimizer
npm run repro:vite
npm run repro:rolldown
```

Run the commands separately: the first two intentionally exit **1** when the
reported behavior reproduces. The Rolldown control exits **0** in the recorded
run. Node 22.12+ is needed for the APIs used here; Node 24.22.1 was tested.

## Optimizer close

`optimizer-close.mjs` uses one middleware server at a time. A real optimizer
plugin holds the scanner's `buildStart` hook. The script requests close,
verifies that close is still waiting, releases the hook and awaits the original
close. It then lists the dedicated cache. Two cases run sequentially: immediate
close and close after public `waitForRequestsIdle()`.

Both cases leave a `deps_temp_*` directory in the recorded run. This is a
scanner/empty-dependencies case, rather than a post-scan `bundle.write()` gate.
No directory is deleted while optimizer work may still be running. Test-owned
fixtures are preserved for inspection after the process exits naturally.

## Closed-build retention

`closed-build.mjs` creates 64 synthetic input modules and completes 16 builds.
Each build has a distinct marker. Only WeakRefs survive the round function;
bundle, output, options and plugin objects are not stored by the harness.
Eight cross-task GC turns run after each round, without dereferencing markers
between rounds. A separate weak-only control must be collected.

The Vite mode observes 16 `closeBundle` calls, then finds all 16 markers still
reachable. The direct Rolldown mode explicitly awaits `bundle.close()` 16 times
and finds none of its callback markers reachable. The cases use different
marker hooks, so this is a limited control, not proof that Rolldown has no
retention defects. RSS and heap samples are diagnostic, not pass thresholds.

```sh
npm run repro:vite -- --snapshot
```

This optionally writes a local heap snapshot after another GC boundary. The
recorded Vite snapshot has a strong path through native global handles,
`deferSyncScanData`, `inputOptions.onLog` and Vite's `ChunkMetadataMap`.
The source parser is not patched or extracted to run this reproduction.

`artifacts/` contains generated observations; `fixtures/` contains generated
inputs and caches. Both are ignored. Heap snapshots may contain local paths;
they should be inspected locally and are not included in the public evidence.

Sanitized recorded logs and environment information are in `evidence/`.
These observations do not establish unlimited growth, guaranteed OOM, or a
single explanation for all downstream RSS growth. No unreleased upstream PR
has been applied or tested. AI tools assisted with preparing the reproductions
and investigation; any public submission requires the submitter's review and
own explanation under the upstream contribution policy.
