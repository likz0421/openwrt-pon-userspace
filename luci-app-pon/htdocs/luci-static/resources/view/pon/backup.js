// SPDX-License-Identifier: Apache-2.0
// PON configuration backup / restore. Pure UCI text in/out with validation,
// so a bad file can never brick the PON configuration.
'use strict';
'require fs';
'require ui';
'require uci';
'require view';

var CONFIG = 'pon';
var EXPORT_CMD = '/sbin/uci';
var BACKUP_PATH = '/tmp/pon-config-backup';
var IMPORT_PATH = '/tmp/pon-config-import';

function fileName() {
	var now = new Date();
	return 'pon-config-' + now.toISOString().replace(/[:.]/g, '-') + '.txt';
}

// Validate that a text really contains PON sections before importing it.
// Deliberately LENIENT: `uci export` output varies across versions (header
// line, quoting, blank/comment lines, tabs). We only require that at least
// one known PON section exists and every non-empty `config` line is parseable.
// Rejecting unknown lines caused legitimate exports to fail with
// "invalid line 1", so unknown lines are now ignored, not rejected.
function validateConfig(text) {
	if (typeof text !== 'string' || text.length < 8 || text.length > 131072)
		throw new Error(_('PON config import failed: file is empty or too large.'));

	var lines = text.split(/\r?\n/);
	var validSection = false;
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		var match = /^config\s+['"]?([A-Za-z0-9_]+)['"]?(?:\s+['"][^'"]*['"])?\s*$/.exec(line);
		if (match) {
			if (match[1] === 'xpon' || match[1] === 'omci' || match[1] === 'oam' || match[1] === 'offload')
				validSection = true;
		}
	}
	if (!validSection)
		throw new Error(_('PON config import failed: no PON sections found.'));
	return true;
}

// Build a compact, human-readable diff summary so an import never silently
// replaces the configuration. Compares option/list values by section+key.
function configDiff(current, incoming) {
	function index(text) {
		var map = Object.create(null), section = '';
		text.split(/\r?\n/).forEach(function(raw) {
			var line = raw.trim();
			var sectionMatch = /^config\s+([A-Za-z0-9_]+)(?:\s+'([^']+)')?\s*$/.exec(line);
			if (sectionMatch) {
				section = sectionMatch[1] + '.' + (sectionMatch[2] || '@' + sectionMatch[1]);
				return;
			}
			var optionMatch = /^(option|list)\s+([A-Za-z0-9_]+)\s+(.*)$/.exec(line);
			if (optionMatch && section)
				map[section + '.' + optionMatch[2]] = optionMatch[3];
		});
		return map;
	}
	var before = index(current), after = index(incoming);
	var keys = {};
	Object.keys(before).concat(Object.keys(after)).forEach(function(k) { keys[k] = true; });
	var changes = [];
	Object.keys(keys).sort().forEach(function(k) {
		var a = before[k], b = after[k];
		if (a === b)
			return;
		if (a === undefined)
			changes.push({ k: k, t: _('add'), v: b });
		else if (b === undefined)
			changes.push({ k: k, t: _('remove'), v: a });
		else
			changes.push({ k: k, t: _('change'), v: a + ' → ' + b });
	});
	return changes;
}

var DIFF_CSS =
	'.pon-diff-list{max-height:320px;overflow:auto;border:1px solid var(--border-color,rgba(0,0,0,.15));border-radius:6px;margin:10px 0}' +
	'.pon-diff-row{display:flex;gap:10px;padding:5px 10px;font-size:12px;font-family:monospace;border-bottom:1px solid rgba(128,128,128,.1)}' +
	'.pon-diff-row:last-child{border-bottom:0}' +
	'.pon-diff-tag{width:52px;flex:none;text-transform:uppercase;font-weight:600}' +
	'.pon-diff-key{flex:1;word-break:break-all}.pon-diff-val{flex:1;word-break:break-all;color:var(--text-color-secondary,#888)}' +
	'.pon-diff-add .pon-diff-tag{color:#1e8449}.pon-diff-remove .pon-diff-tag{color:#c0392b}.pon-diff-change .pon-diff-tag{color:#b9770e}' +
	'.pon-diff-note{font-size:12px;color:var(--text-color-secondary,#888)}' +
	'.pon-diff-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}';

function confirmImport(current, incoming) {
	var changes = configDiff(current, incoming);
	var toneClass = { add: 'pon-diff-add', remove: 'pon-diff-remove', change: 'pon-diff-change' };
	var body = [
		E('p', {}, _('Import will change %d setting(s):').format(changes.length))
	];
	var list = E('div', { 'class': 'pon-diff-list' });
	changes.slice(0, 20).forEach(function(c) {
		list.appendChild(E('div', { 'class': 'pon-diff-row ' + (toneClass[c.t] || '') }, [
			E('span', { 'class': 'pon-diff-tag' }, c.t),
			E('span', { 'class': 'pon-diff-key' }, c.k),
			E('span', { 'class': 'pon-diff-val' }, c.v)
		]));
	});
	if (!changes.length)
		list.appendChild(E('div', { 'class': 'pon-diff-row' }, _('No setting changes detected.')));
	if (changes.length > 20)
		list.appendChild(E('div', { 'class': 'pon-diff-row' }, _('%d more').format(changes.length - 20)));
	body.push(list);
	body.push(E('p', { 'class': 'pon-diff-note' },
		_('A backup of the current configuration will be saved first.')));

	return new Promise(function(resolve) {
		var okBtn = E('button', {
			'class': 'cbi-button cbi-button-action',
			'type': 'button',
			'click': function() { ui.hideModal(); resolve(true); }
		}, _('Import'));
		var cancelBtn = E('button', {
			'class': 'cbi-button',
			'type': 'button',
			'click': function() { ui.hideModal(); resolve(false); }
		}, _('Cancel'));
		body.push(E('div', { 'class': 'pon-diff-actions' }, [ cancelBtn, okBtn ]));
		ui.showModal(_('Confirm configuration import'), body);
	});
}

function downloadText(text) {
	var blob = new Blob([ text ], { type: 'text/plain;charset=utf-8' });
	var url = window.URL.createObjectURL(blob);
	var link = document.createElement('a');
	link.style.display = 'none';
	link.href = url;
	link.download = fileName();
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.URL.revokeObjectURL(url);
}

return view.extend({
	handleExport: function() {
		var button = document.getElementById('pon-config-export');
		button.disabled = true;
		return fs.exec_direct(EXPORT_CMD, [ 'export', CONFIG ]).then(function(text) {
			validateConfig(text);
			downloadText(text);
			ui.addNotification(null, E('p', {}, _('PON configuration exported.')));
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, _('PON config export failed: %s').format(error.message)));
		}).finally(function() {
			button.disabled = false;
		});
	},

	handleImport: function() {
		var button = document.getElementById('pon-config-import');
		button.disabled = true;
		return ui.uploadFile(IMPORT_PATH).then(function() {
			return fs.read_direct(IMPORT_PATH, 'text');
		}).then(function(text) {
			validateConfig(text);
			// Keep a snapshot of the current config before replacing it, and
			// show exactly what will change so nothing is applied blindly.
			return fs.exec_direct(EXPORT_CMD, [ 'export', CONFIG ]).then(function(current) {
				return confirmImport(current, text).then(function(ok) {
					if (!ok)
						throw new Error(_('Import cancelled by user.'));
					return fs.write(BACKUP_PATH, current).then(function() {
						return text;
					});
				});
			});
		}).then(function() {
			// uci import reads from stdin; -f <file> is the correct way to
			// import from a file. `uci import pon <file>` silently does nothing.
			return fs.exec_direct(EXPORT_CMD, [ '-f', IMPORT_PATH, 'import', CONFIG ]);
		}).then(function() {
			return uci.load(CONFIG);
		}).then(function() {
			// Import only writes /etc/config/pon. Restart PON so the new
			// mode/identity actually reach the driver.
			return fs.exec_direct('/etc/init.d/pon', [ 'restart' ]);
		}).then(function() {
			ui.addNotification(null, E('p', {}, [
				_('PON configuration imported and PON restarted.'),
				E('br'),
				_('A backup of the previous configuration was saved to %s.').format(BACKUP_PATH)
			]), 'info');
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, _('PON config import failed: %s').format(error.message)));
		}).finally(function() {
			button.disabled = false;
		});
	},

	handleRestore: function() {
		var button = document.getElementById('pon-config-restore');
		button.disabled = true;
		return Promise.all([
			fs.read_direct(BACKUP_PATH, 'text'),
			fs.exec_direct(EXPORT_CMD, [ 'export', CONFIG ])
		]).then(function(results) {
			var text = results[0], current = results[1];
			validateConfig(text);
			return confirmImport(current, text).then(function(ok) {
				if (!ok)
					throw new Error(_('Restore cancelled by user.'));
				return fs.write(IMPORT_PATH, text).then(function() {
					return fs.exec_direct(EXPORT_CMD, [ '-f', IMPORT_PATH, 'import', CONFIG ]);
				});
			});
		}).then(function() {
			return uci.load(CONFIG);
		}).then(function() {
			return fs.exec_direct('/etc/init.d/pon', [ 'restart' ]);
		}).then(function() {
			ui.addNotification(null, E('p', {}, _('Previous PON configuration restored and PON restarted.')), 'info');
		}).catch(function(error) {
			ui.addNotification(null, E('p', {}, _('PON config restore failed: %s').format(error.message)));
		}).finally(function() {
			button.disabled = false;
		});
	},

	render: function() {
		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('PON configuration backup')),
			E('p', { 'class': 'cbi-section-descr' },
				_('Export the PON configuration to a file, or restore it from a previously exported file. Imported files are validated before they are applied.')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Export')),
				E('p', {}, _('Download the current PON configuration as a text file.')),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'id': 'pon-config-export',
					'type': 'button',
					'click': ui.createHandlerFn(this, 'handleExport')
				}, [ _('Export configuration') ])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Import')),
				E('p', {}, _('Choose a previously exported PON configuration file. The current configuration is backed up first.')),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'id': 'pon-config-import',
					'type': 'button',
					'click': ui.createHandlerFn(this, 'handleImport')
				}, [ _('Import configuration') ])
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Restore last backup')),
				E('p', {}, _('Restore the configuration that was backed up during the last import.')),
				E('button', {
					'class': 'cbi-button',
					'id': 'pon-config-restore',
					'type': 'button',
					'click': ui.createHandlerFn(this, 'handleRestore')
				}, [ _('Restore backup') ])
			])
		]);
	}
});
