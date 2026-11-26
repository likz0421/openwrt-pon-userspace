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

// Only accept a UCI export that really contains PON sections. This guards
// against importing an arbitrary file and silently wiping the configuration.
function validateConfig(text) {
	if (typeof text !== 'string' || text.length < 8 || text.length > 131072)
		throw new Error(_('PON config import failed: file is empty or too large.'));

	var lines = text.split(/\r?\n/);
	var sections = 0;
	var validSection = false;
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i].trim();
		if (!line || line.charAt(0) === '#')
			continue;
		var match = /^config\s+([A-Za-z0-9_]+)(?:\s+'([^']+)')?\s*$/.exec(line);
		if (match) {
			sections++;
			if (match[1] === 'xpon' || match[1] === 'omci' || match[1] === 'oam' || match[1] === 'offload')
				validSection = true;
			continue;
		}
		if (!/^\s*(option|list)\s+[A-Za-z0-9_]+\s+/.test(line))
			throw new Error(_('PON config import failed: invalid line %d.').format(i + 1));
	}
	if (sections === 0 || !validSection)
		throw new Error(_('PON config import failed: no PON sections found.'));
	return true;
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
			// Keep a snapshot of the current config before replacing it.
			return fs.exec_direct(EXPORT_CMD, [ 'export', CONFIG ]).then(function(current) {
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
		return fs.read_direct(BACKUP_PATH, 'text').then(function(text) {
			validateConfig(text);
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
