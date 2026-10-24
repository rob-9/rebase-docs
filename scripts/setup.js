// Prints instructions only; never creates a project, uploads, or deploys code.
console.log(`Google Docs Editor add-on setup

1. Create a standalone Apps Script project at https://script.google.com/.
2. Add each src/*.js file as a Script file and both src/*.html files as HTML.
3. In Project Settings, show appsscript.json, then replace it with src/appsscript.json.
4. Confirm the Google Docs advanced service is enabled. If the script uses a
   standard Google Cloud project, enable the Google Docs API there too.
5. Choose Deploy > Test deployments > Editor add-on. Select a simple test Doc
   and the installed-and-enabled authorization state, then execute the test.
6. In the Doc, open Extensions > your add-on > Open Docs Rebase and authorize it.
7. Create linked copy, then add the new copy to the same project's test
   deployments. Open the add-on in that copy and edit the parent and copy.

Alternative upload: install Google's clasp CLI, authenticate, copy
.clasp.example.json to .clasp.json, enter your existing script ID, and run
clasp push yourself. The src directory is the upload root.

Development previews do not support installable triggers. Test hourly background
sync separately in an installed add-on. Publishing requires Google Workspace
Marketplace/OAuth setup and review; this script does not publish anything.

Prototype limits: one document tab, text paragraphs, 20,000 UTF-16 characters,
and one controlling Google account per copy. Edit access is required to both
documents for revision checks. Parent formatting/comments do not sync. Text
inserted into the copy inherits local formatting; paragraph splits/joins can
change paragraph styling. Suggestions, tables, images, chips, headers, footers,
footnotes, and extra sections pause sync. Normal File > Make a copy does not
register a parent; link it while text still matches or create the copy here.

Conflicts pop up while the sidebar is open. Background sync leaves conflicts
pending until the sidebar is reopened. Google Docs exposes no onEdit trigger.
Snapshots live in compressed per-user Apps Script properties; large or numerous
copies may hit the storage limit. Disconnecting removes their saved snapshots.
The add-on requests Docs access, Drive access to create copies, editor UI access,
and trigger management. It writes only to linked copies and never to parents.
Google Docs version history remains available for reviewing or undoing changes.

Local checks: npm test && npm run check
Local preview: npm run demo (no Google connection)
Browser checks: npm run test:ui after installing dev dependencies
`);
