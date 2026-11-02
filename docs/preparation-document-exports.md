# Document names, profiles, and version exports

In **Preparation** (or **Settings → Job profiles and bundles**):

- Use **Rename** beside a supporting document to change its library name without replacing its PDF.
- Edit each profile item's **export name** to rename the CV/letter or override a supporting-document name for that profile. Leave it blank to use the default/library name. Enter names without `.pdf`.
- Select an existing profile and choose **Clone profile**. Enter a new unique profile name, edit the documents and their order, then save. The original profile is preserved.

Effective names are saved with each prepared package. To use revised names with existing PDFs, select the revised profile and choose **Regenerate merged PDF**. This creates a new package version without AI generation; earlier versions retain their original names and files.

In an application's **Preparation** panel, use **Separate and grouped PDFs**:

1. Select a package version.
2. Choose **All separate**, **Single bundle**, or edit the output groups. Documents within each group can be reordered. A document may appear in more than one output.
3. Choose **Export files**. Existing filenames require explicit replacement confirmation. Other files are retained.
4. Download the outputs or choose **Open version folder**.

Outputs are saved under `<application-folder>/vN/` as `BenHamouda_Dhia-{name}.pdf` or `BenHamouda_Dhia-{name1}_{name2}.pdf`. Exports use the exact document versions pinned to the selected package. They do not invoke AI or a LaTeX compiler.

Manual validation: rename and clone a profile, regenerate its merged package, export individual/grouped files in the chosen order, compare an older version, and repeat an export to check Cancel/Replace behavior.

Reload the development app and all-host preparation worker after updating:

```sh
docker compose restart app
systemctl --user restart dossier-application-worker.service
```

Wait for active preparations to finish before restarting the worker. For a containerized worker, rebuild/restart that worker instead and restart its host companion (`btalalos-application-host.service`). Refresh the browser with Ctrl+Shift+R.
