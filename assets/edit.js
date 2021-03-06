$(function() {
	"use strict";

	var recentTags,
		Set,
		localStorage = window.localStorage,
		currentFields = {},
		currentTimeout = 0,
		startHash,
		space = tiddlyweb.status.space.name,
		currentBag,
		defaultBag = space + '_public',
		host = '/',
		publicIcon = 'bags/tiddlyspace/tiddlers/publicIcon',
		privateIcon = 'bags/tiddlyspace/tiddlers/privateIcon',
		extracludeRE = /^.extraclude (.+?)\s*$([\s\S]*?)^.extraclude$/mg;

	Set = function() {};
	Set.prototype.add = function(o) { this[o] = true; };
	Set.prototype.remove = function(o) { delete this[o]; };
	recentTags = new Set();
	startHash = adler32('');

	$(window).bind('beforeunload', function(e) {
		var currentHash = adler32($('input[name=tags]').val()
				+ $('textarea[name=text]').val());
		e.stopPropagation();
		if (currentHash !== startHash) {
			e.returnValue = 'You have unsaved changes.';
			return e.returnValue;
		}

	});

	$(window).bind('hashchange', checkHash);

	$('#revert').bind('click', function() {
		$('button, input, .inputs').attr('disabled', 'disabled');
		var title = $('#editor > h1').text(),
			uri = tiddlerURI(host, currentBag, title);
		flushStorage(uri);
		startEdit($('#editor > h1').text());
	});

	$('#save').bind('click', function() {
		$('button, input, .inputs').attr('disabled', 'disabled');
		saveEdit(function() {
			var title = $('#editor > h1').text(),
				uri = tiddlerURI(host, currentBag, title);
			flushStorage(uri);
			changes();
		});
	});

	$('#saver').bind('click', function() {
		$('button, input, .inputs').attr('disabled', 'disabled');
		saveEdit(function() {
			var title = encodeURIComponent($('#editor > h1').text()),
				uri = tiddlerURI(host, currentBag, title);
			flushStorage(uri);
			startHash = adler32($('input[name=tags]').val()
					+ $('textarea[name=text]').val());
			window.location.href = '/' + title;
		});
	});

	$('#delete').bind('click', function() {
		var title = encodeURIComponent($('#editor > h1').text());
		$('button, input, .inputs').attr('disabled', 'disabled');
		if (currentBag) {
			if (confirm('Are you sure you want to delete ' + title + '?')) {
				$('input[name=tags]').val('');
				$('textarea[name=text]').val('');
				$('#editor > h1').text('');
				startHash = adler32('');
				deleteTiddler(title);
			}
		} else {
			displayMessage('Tiddler never saved to server.');
		}
	});

	/* 
	 * Establish a timeout for auto-saving.
	 */
	function establishInterval() {
		var timeoutId = 0,
			currentHash;
		if (localStorage) {
			timeoutId = setInterval(function () {
				var title = $('#editor > h1').text(),
					text = $('textarea[name=text]').val(),
					tags = readTagView(),
					tiddler = {
						title: title,
						text: text,
						tags: tags,
						fields: currentFields,
						bag: currentBag || defaultBag,
						contentType: $('[name=type]:checked').val()
					},
					uri = tiddlerURI(host, currentBag, title);
				currentHash = adler32($('input[name=tags]').val()
					+ $('textarea[name=text]').val());
				if (currentHash !== startHash) {
					localStorage.setItem(uri, JSON.stringify(tiddler));
				}
			}, 10000);
		}
		return timeoutId;
	}

	/*
	 * Flush the current data out of localStorage.
	 */
	function flushStorage(uri) {
		if (localStorage) {
			if (currentTimeout) {
				window.clearInterval(currentTimeout);
			}
			localStorage.removeItem(uri);
		}
	}

	/*
	 * Fade in an announcement text message.
	 */
	function displayMessage(message, extra) {
		var content = $('<p>').text(message);
		$('#message').empty();
		$('#message').append(content);
		if (extra) {
			$('#message').append(extra);
		}
		$('#message').fadeIn();
	}

	/*
	 * Display an icon indicating privacy status of tiddler.
	 */
	function setIcon(privatep) {
		$('.privacyicon').remove();
		var img = $('<img>').attr({
			src: host + (privatep ? privateIcon : publicIcon),
			'class': 'privacyicon'
		});

		if (!currentBag) {
			img.css('cursor', 'pointer')
				.click(function() {
					var target = privatep ? 'public' : 'private';
					if (confirm('Switch to '
							+ (privatep ? 'public' : 'private') + '?')) {
						currentBag = space + '_' + target;
						setIcon(!privatep);
					}
				});
		}
		$('#type').prepend(img);
	}

	/*
	 * Given host, bag and title make a good URI
	 * for a tiddler.
	 */
	function tiddlerURI(host, bag, title) {
		return host + 'bags/'
			+ encodeURIComponent(bag ? bag : defaultBag)
			+ '/tiddlers/'
			+ encodeURIComponent(title);
	}

	/*
	 * Send a DELETE for the tiddler named by title.
	 */
	function deleteTiddler(title) {
		if (title && currentBag) {
			$(window).unbind('hashchange');
			window.location.hash = '';
			$(window).bind('hashchange', checkHash);
			var uri = tiddlerURI(host, currentBag, title);
			$.ajax({
				url: uri,
				type: 'DELETE',
				success: changes
			});
		} else {
			displayMessage('Nothing to delete.');
		}
	}

	/*
	 * Inform a non-member that they may not edit.
	 */
	function guestPage() {
		$('button, input, .inputs').attr('disabled', 'disabled');
		$('#message').text('You are not a member of this space, so cannot edit. ');
		var link = $('<a>')
			.attr('href', host)
			.text('Visit the space.');
		$('#message').append(link).fadeIn();
	}

	/*
	 * Save the text and tags to the title in currentBag.
	 */
	function saveEdit(callback) {
		callback = callback || changes;
		var title = $('#editor > h1').text();
		if (title) {
			_processText(title, $('textarea[name=text]').val(), callback);
		} else {
			displayMessage('There is nothing to save');
		}
	}

	/*
	 * Search for '.extraclude' in page and do an
	 * extraclusion if found. Multiples possible.
	 */
	function _processText(title, text, callback) {
		var newTiddlers = {},
			match,
			subtitle,
			subtext,
			tiddler;

		while (match = extracludeRE.exec(text)) {
			subtitle = match[1];
			subtext = match[2].replace(/^\s*/, '').replace(/\s*$/, '');
			tiddler = {
				text: subtext,
				type: currentFields.type
			};
			newTiddlers[subtitle] = tiddler;
		}

		var countTiddlers = Object.keys(newTiddlers).length,
			countSuccess = 0,
			postExtra = function() {
				countSuccess += 1;
				if (countSuccess >= countTiddlers) {
					text = text.replace(extracludeRE, '<<tiddler [[$1]]>>');
					_saveEdit(title, text, callback);
				}
			},
			postExtraFail = function(xhr, status, errorThrown) {
				displayMessage('Extraclude failed' + status);
			};

		if (countTiddlers) {
			for (subtitle in newTiddlers) {
				if (newTiddlers.hasOwnProperty(subtitle)) {
					_putTiddler(subtitle, newTiddlers[subtitle], postExtra,
							postExtraFail);
				}
			}
		} else {
			_saveEdit(title, text, callback);
		}
	}

	/*
	 * PUT a tiddler that was extracluded.
	 */
	function _putTiddler(title, tiddlerData, successCall, errorCall) {
		var jsonText = JSON.stringify(tiddlerData);
		$.ajax({
			url: tiddlerURI(host, currentBag, title),
			type: 'PUT',
			data: jsonText,
			contentType: 'application/json',
			success: successCall,
			error: errorCall
		});
	}


	function _saveEdit(title, text, callback) {
		var tags = readTagView(),
			tiddler = {};
		tiddler.text = text;
		tiddler.tags = tags;
		tiddler.type = currentFields.type;
		delete currentFields.type;
		tiddler.fields = currentFields;

		// update content based on radio buttons
		var matchedType = $('[name=type]:checked').val();
		if (matchedType !== 'other') {
			if (matchedType === 'default') {
				delete tiddler.type;
			} else {
				tiddler.type = matchedType;
			}
		}

		var jsonText = JSON.stringify(tiddler);
		$.ajax({
			beforeSend: function(xhr) {
				if (tiddler.fields['server.etag']) {
					xhr.setRequestHeader('If-Match',
						tiddler.fields['server.etag']);
				}
			},
			url: tiddlerURI(host, currentBag, title),
			type: "PUT",
			contentType: 'application/json',
			data: jsonText,
			success: callback,
			statusCode: {
				412: function() {
					displayMessage('Edit Conflict');
					// re-enable text and tags to allow copy
					$('.inputs').removeAttr('disabled');
				}
			}
		});
	}

	/*
	 * Read the current tags from the input into an array.
	 */
	function readTagView(tagString) {
		var tags = [];
		tagString = tagString || $('input[name=tags]').val();
		var matches = tagString.match(/([^ \]\[]+)|(?:\[\[([^\]]+)\]\])/g) || [];
		$.each(matches, function(index, value) {
			tags.push(value.replace(/[\]\[]+/g, ''));
		});
		return tags;
	}

	/*
	 * Write updated tags into the tag view. If a non-false second
	 * argument is passed, it is assumed to be a tag that is being
	 * added or removed.
	 */
	function updateTagView(tags, changedTag) {
		var outputTags = [],
			changedIndex;

		if (changedTag) {
			changedIndex = tags.indexOf(changedTag);
			if (changedIndex === -1) {
				tags.push(changedTag);
			} else {
				tags.splice(changedIndex, 1);
			}
		}

		$.each(tags, function(index, tag) {
			if (tag.match(/ /)) {
				outputTags.push('[[' + tag + ']]');
			} else {
				outputTags.push(tag);
			}
		});

		$('#editor input').val(outputTags.join(' '));
	}

	/*
	 * Display the most recently used tags.
	 */
	function updateTags(tags) {
		$('#tags').empty();
		tags = Object.keys(tags);
		tags = tags.sort();
		$.each(tags, function(index, tag) {
			var taglink = $('<a>')
				.text(tag)
				.addClass('taglink')
				.bind('click', function() {
					updateTagView(readTagView(), tag);
				});
			$('#tags').append(taglink);
		});
	}

	function updateContentType(tiddlerType) {
		$('[name=type]').prop('checked', false);
		var matchedType = $('[name=type]')
			.filter('[value="' + tiddlerType + '"]');
		if (matchedType.length) {
			matchedType.prop('checked', true);
		} else if (tiddlerType) {
			$('[name=type]').filter('[value=other]').prop('checked', true);
		} else {
			$('[name=type]').filter('[value="default"]').prop('checked', true);
		}
	}

	/*
	 * Callback after tiddler is GET from server, filling in forms,
	 * preparing for edit.
	 */
	function establishEdit(tiddler, status, xhr) {
		currentBag = tiddler.bag;

		$('textarea[name=text]').val(tiddler.text);
		currentFields = tiddler.fields;
		currentFields.type = tiddler.type;

		// update the content type buttons
		updateContentType(tiddler.type);

		if (xhr) {
			currentFields['server.etag'] = xhr.getResponseHeader('etag');
		}
		updateTagView(tiddler.tags, null);

		if (tiddler.permissions && tiddler.permissions.indexOf('write') === -1) {
			$('button, input, .inputs').attr('disabled', 'disabled');
			displayMessage('Edit permission denied. Choose another tiddler.');
			return;
		}

		startHash = adler32($('input[name=tags]').val()
				+ $('textarea[name=text]').val());

		currentTimeout = establishInterval();
		if (currentBag.match(/_(private|public)$/)) {
			setIcon(currentBag.match(/_private$/));
		}
	}

	/*
	 * Check to see if there is backup data for the current tiddler
	 */
	function checkBackup(tiddlerTitle) {
		if (localStorage) {
			var uri = tiddlerURI(host, currentBag, tiddlerTitle),
				data = localStorage.getItem(uri);
			return data;
		}
		return null;
	}

	/*
	 * Get the named tiddler to do an edit.
	 */
	function startEdit(tiddlerTitle, freshTags, freshType) {
		$('#message').fadeOut('slow');
		$('button, input, .inputs').removeAttr('disabled');

		$('#editor > h1').text(tiddlerTitle);
		var tiddlerBackup = checkBackup(tiddlerTitle);
		if (tiddlerBackup) {
			/*
			 * We flushStorage whether they confirm or cancel:
			 * we already have the data.
			 */
			var uri = tiddlerURI(host, currentBag, tiddlerTitle);
			flushStorage(uri);
			if (confirm("There's a backup for this tiddler. Use it?")) {
				var data = JSON.parse(tiddlerBackup);
				data.type = data.contentType;
				delete data.contentType;
				return establishEdit(data);
			}
		}
		$.ajax({
			dataType: 'json',
			headers: {'Cache-Control': 'max-age=0'},
			url: host + encodeURIComponent(tiddlerTitle),
			success: establishEdit,
			statusCode: {
				404: function() {
					$('[name=type]')
						.filter('[value="default"]')
						.prop('checked', true);
					$('textarea[name=text]').val('');
					setIcon(false);
					currentTimeout = establishInterval();
					updateContentType(freshType);
					updateTagView(readTagView(freshTags), null);
					currentFields = {};
				}
			}
		});
	}

	function emptyEdit() {
		$('button, input, .inputs').attr('disabled', 'disabled');
		var titler = $('<input id="editnew">')
			.attr('placeholder', 'Or enter a new title')
			.bind('change', editNew);
		displayMessage('Select a tiddler to edit from the right.', titler);
	}

	function editNew() {
		var newTitle = $(this).val();
		if (newTitle) {
			startEdit(newTitle);
		}
	}

	/*
	 * Check the href anchor to see if we've been told what to edit.
	 */
	function checkHash() {
		var hash = window.location.hash,
			title,
			tagString,
			type,
			args;
		if (hash) {
			hash = hash.replace(/^#/, '');
			args = hash.split('/');
			if (args.length === 4) {
				args[2] = args.slice(2).join('/');
				args.pop();
			}
			$.each(args, function(index, arg) {
				args[index] = decodeURIComponent(arg);
			});
			title = args[0] || emptyEdit();
			tagString = args[1] || '';
			type = args[2] || '';
			startEdit(title, tagString, type);
		} else {
			emptyEdit();
		}
	}

	/*
	 * Display the recent changes.
	 */
	function displayChanges(tiddlers) {
		$.each(tiddlers, function(index, tiddler) {
			if (!tiddler.type ||
					tiddler.type.match(/^text/)) {
				$.each(tiddler.tags, function(index, tag) {
					recentTags.add(tag);
				});
				var penSpan = $('<span>').text('\u270E')
					.bind('click', function() {
						var title = $(this).parent().attr('data-tiddler-title');
						$(window).unbind('hashchange');
						window.location.hash = title;
						$(window).bind('hashchange', checkHash);
						startEdit(title);
					}),

					tiddlerLink = $('<a>').attr({
						href: '/' + encodeURIComponent(tiddler.title),
						target: '_blank'
					}).text(tiddler.title),

					list = $('<li>').attr('data-tiddler-title',
						tiddler.title).append(tiddlerLink).prepend(penSpan);
				$('#recents > ul').append(list);
			}
		});
		updateTags(recentTags);
	}

	/* 
	 * Get the 20 most recently changed tiddlers in the public and private
	 * bag of the space, callback to displayChanges.
	 */
	function changes() {
		$('#recents > ul').empty();
		$.ajax({
			dataType: 'json',
			headers: {'Cache-Control': 'max-age=0'},
			url: host + 'search?q=bag:' + encodeURIComponent(space)
				+ '_public%20OR%20bag:' + encodeURIComponent(space)
				+ '_private',
			success: displayChanges
		});
		checkHash();
	}

	/*
	 * Start up, establishing if the current user has the power to edit.
	 */
	function init() {
		$.ajaxSetup({
			beforeSend: function(xhr) {
				xhr.setRequestHeader("X-ControlView", "false");
			}
		});

		var recipe = tiddlyweb.status.space.recipe;

		if (recipe.match(/_private$/)) {
			changes();
		} else {
			guestPage();
		}
	}

	function adler32(a){for(var b=65521,c=1,d=0,e=0,f;f=a.charCodeAt(e++);d=(d+c)%b)c=(c+f)%b;return(d<<16)|c}; // see https://gist.github.com/1200559/1c2b2093a661c4727958ff232cd12de8b8fb9db9

	init();
});
