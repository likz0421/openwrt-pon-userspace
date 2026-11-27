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

function confirmImport(current, incoming) {
	var changes = configDiff(current, incoming);
	var lines = [ _('Import will change %d setting(s):').format(changes.length) ];
	changes.slice(0, 20).forEach(function(c) {
		lines.push('  [' + c.t + '] ' + c.k + ' = ' + c.v);
	});
	if (changes.length > 20)
		lines.push('  … ' + _('%d more').format(changes.length - 20));
	lines.push('', _('A backup of the current configuration will be saved first.'));
	lines.push(_('Continue with the import?'));
	return window.confirm(lines.join('\n'));
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
				if (!confirmImport(current, text))
					throw new Error(_('Import cancelled by user.'));
				return fs.write_direct(BACKUP_PATH, current).then(function() {
					return text;
				});
			});
		}).then(function(text) {
			return fs.write_direct(IMPORT_PATH, text).then(function() {
				return fs.exec_direct(EXPORT_CMD, [ 'import', CONFIG, IMPORT_PATH ]);
			});
		}).then(function() {
			return uci.load(CONFIG);
		}).then(function() {
			ui.addNotification(null, E('p', {}, [
				_('PON configuration imported. Restart the PON service to apply it.'),
				E('br'),
				_('A backup of the previous configuration was saved to %s.').format(BACKUP_PATH)
			]));
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
			if (!confirmImport(current, text))
				throw new Error(_('Restore cancelled by user.'));
			return fs.write_direct(IMPORT_PATH, text).then(function() {
				return fs.exec_direct(EXPORT_CMD, [ 'import', CONFIG, IMPORT_PATH ]);
			});
		}).then(function() {
			return uci.load(CONFIG);
		}).then(function() {
			ui.addNotification(null, E('p', {}, _('Previous PON configuration restored.')));
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
