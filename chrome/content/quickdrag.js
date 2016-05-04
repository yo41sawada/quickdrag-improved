/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is QuickDrag.
 *
 * The Initial Developer of the Original Code is Kai Liu.
 * Portions created by the Initial Developer are Copyright (C) 2008-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Kai Liu <kliu@code.kliu.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

var QuickDragListener =
{
	// The name of the event that we should listen to for drops
	_drop: "drop",

	handleEvent: function( evt )
	{
		var panel = gBrowser.mPanelContainer;

		switch (evt.type)
		{
			case "load":
			{
				// Prior to the landing of the WHATWG drag API in Gecko 1.9.1,
				// the event name was "dragdrop"
				if (typeof(nsDragAndDrop) != "undefined" && "getDragData" in nsDragAndDrop)
					this._drop = "dragdrop";

				window.removeEventListener(evt.type, this, false);
				panel.addEventListener("dragstart", this, false);
				panel.addEventListener("dragover", this, false);
				panel.addEventListener(this._drop, this, false);
				break;
			}

			case "unload":
			{
				window.removeEventListener(evt.type, this, false);
				panel.removeEventListener("dragstart", this, false);
				panel.removeEventListener("dragover", this, false);
				panel.removeEventListener(this._drop, this, false);
				break;
			}

			case "dragstart":
			{
				QuickDrag.dragstart(evt);
				break;
			}

			case "dragover":
			{
				QuickDrag.dragover(evt);
				break;
			}

			case this._drop:
			{
				QuickDrag.dragdrop(evt);
				break;
			}
		}
	}
};

var QuickDrag =
{
	_ds: Components.classes["@mozilla.org/widget/dragservice;1"].
	     getService(Components.interfaces.nsIDragService),

	_ps: Components.classes["@mozilla.org/preferences-service;1"].
	     getService(Components.interfaces.nsIPrefService).
	     getBranch("extensions.quickdrag."),

	/**
	 * In the beginning, there was the nsDragAndDrop wrapper, and it was used.
	 * It was did not entirely suit QuickDrag, so it was deprecated, but parts
	 * of it remained, wrapped in _session, _getDragData and _securityCheck.
	 * With Gecko 1.9.1, the introduction of WHATWG drag limited nsDragAndDrop
	 * to just providing us with the drag session, and the removal in Firefox 4
	 * of nsDragAndDrop meant that, not only did QuickDrag have to obtain the
	 * session manually, but that it had to check for the functionality of the
	 * nsDragAndDrop wrapper (to enable code paths that enable compatibility
	 * with Gecko 1.9.0 and earlier) in a way that did not crash QuickDrag.
	 **/

	// We want to know the "true" source of the drag, which we can no longer
	// reliably get from the drag session in Gecko 1.9.1
	_sourceNode: null,

	// Wrapper for getting the current drag session
	get _session( )
	{
		var session = this._ds.getCurrentSession();

		// Legacy pre-1.9.1 support: ensure that nsDragAndDrop is initialized
		if (typeof(nsDragAndDrop) != "undefined" && !nsDragAndDrop.mDragSession)
			nsDragAndDrop.mDragSession = session;

		return(session);
	},

	// Wrapper for nsDragAndDrop.js's data retrieval; see nsDragAndDrop.drop
	_getDragData: function( aEvent )
	{
		var data = "";
		var type = "text/unicode";

		if ("dataTransfer" in aEvent)
		{
			// Gecko 1.9.1 and newer: WHATWG drag-and-drop

			// Try to get text/x-moz-url, if possible
			data = aEvent.dataTransfer.getData("text/x-moz-url");

			if (data.length != 0)
				type = "text/x-moz-url";
			else
				data = aEvent.dataTransfer.getData("text/plain");
		}
		else if (typeof(nsDragAndDrop) != "undefined" && "getDragData" in nsDragAndDrop)
		{
			// Gecko 1.9.0 and older: wrapper for nsDragAndDrop.getDragData

			var flavourSet = new FlavourSet();
			flavourSet.appendFlavour("text/x-moz-url");
			flavourSet.appendFlavour("text/unicode");

			var transferDataSet = nsTransferable.get(flavourSet, nsDragAndDrop.getDragData, true);

			data = transferDataSet.first.first.data;
			type = transferDataSet.first.first.flavour.contentType;
		}

		return({ data: data, type: type });
	},

	// Wrapper for nsDragAndDrop.dragDropSecurityCheck
	_securityCheck: function( aEvent, aDragSession, aDraggedText )
	{
		if (typeof(nsDragAndDrop) != "undefined" && "dragDropSecurityCheck" in nsDragAndDrop)
			nsDragAndDrop.dragDropSecurityCheck(aEvent, aDragSession, aDraggedText);
		else if ("dragDropSecurityCheck" in gBrowser)
			gBrowser.dragDropSecurityCheck(aEvent, aDragSession, aDraggedText);
	},

	// Should an ImageDocument be saved?
	_allowImageDocumentSave: function( evt )
	{
		try {
			if (this._ps.getBoolPref("disallowImageDocumentSave"))
				return(false);
		} catch (e) { }

		return(this._ps.getBoolPref("downloadImages") || evt.altKey);
	},

	// Exempt handling of drags from (Image|SVG|XUL)Document
	_isExemptedDocument: function( node, evt )
	{
		try {
			doc = node.ownerDocument.defaultView.top.document;
			return(
				(doc instanceof Components.interfaces.nsIImageDocument && !this._allowImageDocumentSave(evt)) ||
				(doc instanceof Components.interfaces.nsIDOMSVGDocument) ||
				(node.ownerDocument instanceof Components.interfaces.nsIDOMXULDocument)
			);
		} catch (e) { }

		return(false);
	},

	// Determine if two DOM nodes are from the same content area.
	_fromSameContentArea: function( node1, node2 )
	{
		if (node1 == null || node2 == null)
			return(true);

		return(
			node1.ownerDocument && node1.ownerDocument.defaultView &&
			node2.ownerDocument && node2.ownerDocument.defaultView &&
			node1.ownerDocument.defaultView.top.document ==
			node2.ownerDocument.defaultView.top.document
		);
	},

	// Bugs #251 & #279: Support turning off the handling of certain drag types
	_checkHandlePrefs: function( node )
	{
		if (node == null)
			return(true);
		else if (node.nodeName == "IMG")
			return(this._ps.getBoolPref("handleImageDrags"));
		else
			return(this._ps.getBoolPref("handleNonImageDrags"));
	},

	// Bug #281: Determine if a DOM node accepts drops so that we can exempt it
	_nodeAcceptsDrops: function( node )
	{
		if (!node) return(false);

		return(
			(node.nodeName == "TEXTAREA") ||
			("mozIsTextField" in node && node.mozIsTextField(false)) ||
			("isContentEditable" in node && node.isContentEditable) ||
			(node.ownerDocument.designMode.toLowerCase() == "on") ||
			(node.hasAttribute("dropzone") && node.getAttribute("dropzone").replace(/^\s+|\s+$/g, "").length)
		);
	},

	// Is this an event that we want to handle?
	_shouldHandleEvent: function( evt )
	{
		var source = (this._sourceNode) ? this._sourceNode : this._session.sourceNode;

		return(
			(this._session.isDataFlavorSupported("text/unicode") ||
			 this._session.isDataFlavorSupported("text/plain")) &&

			!this._isExemptedDocument(source, evt) &&
			 this._fromSameContentArea(source, evt.target) &&
			!this._nodeAcceptsDrops(evt.target) &&
			 this._checkHandlePrefs(source)
		);
	},

	/**
	 * Event handlers
	 **/

	dragstart: function( evt )
	{
		this._sourceNode = evt.explicitOriginalTarget;
	},

	dragover: function( evt )
	{
		if (!this._shouldHandleEvent(evt)) return;

		this._session.canDrop = true;
	},

	dragdrop: function( evt )
	{
		if (!this._shouldHandleEvent(evt)) return;

		// Load preferences; note that the pref is FG, but the var is BG
		var loadLinkInBG = !this._ps.getBoolPref("loadLinkInFG") ^ evt.shiftKey;
		var loadSearchInBG = !this._ps.getBoolPref("loadSearchInFG") ^ evt.shiftKey;
		var downloadImages = this._ps.getBoolPref("downloadImages") || evt.altKey;
		var linkOpenOverride = this._ps.getBoolPref("linkOpenOverride");

		// Get the source node and name
		var sourceNode = this._session.sourceNode;

		if (this._sourceNode)
		{
			sourceNode = this._sourceNode;
			this._sourceNode = null;
		}

		var sourceName = (sourceNode) ? sourceNode.nodeName : "";

		// Flags
		var isURI = false;
		var isImage = false;
		var isAnchorLink = false;

		// Parse the drag data
		var dragData = this._getDragData(evt);
		var lines = dragData.data.replace(/^\s+|\s+$/g, "").split(/\s*\n\s*/);
		var str = lines.join(" ");

		if (dragData.type == "text/x-moz-url")
		{
			// The user has dragged either a link or an image

			// By default, we want to use the URI (the first line)
			str = lines[0];
			isURI = true;

			if (sourceName == "IMG")
			{
				// Image or image link
				isImage = true;

				// If the URI does not match the source node, then this is a
				// linked image (note that we DO want to treat images linked to
				// themselves as if they are not linked at all)
				if (sourceNode.src != str)
					isAnchorLink = true;
			}
			else if (sourceName == "#text")
			{
				// Text link
				isAnchorLink = true;

				// The link's content text, condensed into one line
				var text = lines.slice(1).join(" ");

				// If appropriate, use the content text instead of the URI
				if (!linkOpenOverride && text)
				{
					str = text;
					isURI = false;
				}

				// ...and hack around a Firefox 2 bug
				else if (!text && !("dataTransfer" in evt))
					isURI = false;
			}
		}

		// Abort if we have no data; otherwise, proceed with URI detection
		if (!str) return;

		// Our heuristics; see bug 58 for info about the http fixup
		var hasScheme = /^(?:(?:h?tt|hxx)ps?|ftp|chrome|file):\/\//i;
		var hasIP = /(?:^|[\/@])(?:\d{1,3}\.){3}\d{1,3}(?:[:\/\?]|$)/;
		var hasDomain = new RegExp(
			// starting boundary
			"(?:^|[:\\/\\.@])" +
			// valid second-level name
			"[a-z0-9](?:[a-z0-9-]*[a-z0-9])" +
			// valid top-level name: ccTLDs + hard-coded [gs]TLDs
			"\\.(?:[a-z]{2}|aero|asia|biz|cat|com|coop|edu|gov|info|int|jobs|mil|mobi|museum|name|net|onion|org|pro|tel|travel|xxx)" +
			// end boundary
			"(?:[:\\/\\?]|$)",
			// ignore case
			"i"
		);

		isURI = isURI || hasScheme.test(str);
		isURI = isURI || (!/\s/.test(str) && (hasIP.test(str) || hasDomain.test(str)));

		// If searching, copy search text to clipboard if the Ctrl key was held
		if (!isURI && evt.ctrlKey)
		{
			Components.classes["@mozilla.org/widget/clipboardhelper;1"]
			          .getService(Components.interfaces.nsIClipboardHelper)
			          .copyString(str);
		}

		if (isURI)
		{
			// The scheme fixup here is more relaxed; patterns that match this
			// fixup but that failed the initial scheme heuristic are those
			// that match a valid domain or IP address pattern
			str = str.replace(/^(?:t?t|h[tx]{2,})p(s?:\/\/)/i, "http$1");

			// Call dragDropSecurityCheck
			this._securityCheck(evt, this._session, str);

			// Treat drag as a middle click?
			var mimicMiddleClick = isAnchorLink && linkOpenOverride;

			// Send the referrer only for embedded images or emulated
			// middle clicks over HTTP/HTTPS
			var referrer = null;

			if (sourceNode)
			{
				referrer = Components.classes["@mozilla.org/network/io-service;1"].
				           getService(Components.interfaces.nsIIOService).
				           newURI(sourceNode.ownerDocument.location.href, null, null);

				if (!((isImage || mimicMiddleClick) && /^https?$/i.test(referrer.scheme)))
					referrer = null;
			}

			// Turn naked e-mail addresses into mailto: links
			if (/^[\w\.\+\-]+@[\w\.\-]+\.[\w\-]{2,}$/.test(str))
				str = "mailto:" + str;

			// For image links, the we want to use the source URL unless we
			// are going to treat the image as a link
			if (isImage && (!mimicMiddleClick || evt.ctrlKey))
				str = sourceNode.src;

			if (isImage && !mimicMiddleClick && !evt.ctrlKey && downloadImages)
				this._saveImage(str, referrer, sourceNode.ownerDocument);
			else if (!evt.altKey || (isImage && evt.ctrlKey) || !this._saveURL(str, referrer, sourceNode.ownerDocument))
				this._loadTab(str, referrer, null, loadLinkInBG);
		}
		else if (this._isSuite)
		{
			// Suite search
			if (typeof(BrowserSearch) != "undefined")
				BrowserSearch.loadSearch(str, true);
			else if (typeof(OpenSearch) != "undefined")
				OpenSearch('qdsearch', str, true, evt.shiftKey);
		}
		else
		{
			// Firefox search
			// Based on BrowserSearch::loadSearch in browser.js

			const ss = Components.classes["@mozilla.org/browser/search-service;1"].
			           getService(Components.interfaces.nsIBrowserSearchService);

			// Test to see if the search bar is active
			var searchBarActive = false;
			var searchBar = document.getElementById("searchbar");
			if (searchBar)
			{
				var style = window.getComputedStyle(searchBar.parentNode, null);
				if (style.visibility == "visible" && style.display != "none")
					searchBarActive = true;
			}

			// If the search bar is visible, use the current engine;
			// otherwise, fall back to the default engine
			var engine = (searchBarActive) ? ss.currentEngine : ss.defaultEngine;
			var submission = engine.getSubmission(str, null);

			// Open the search in a new tab
			this._loadTab(submission.uri.spec, null, submission.postData, loadSearchInBG);
		}

		evt.preventDefault();
		evt.stopPropagation();
	},

	/**
	 * Application-specific compatibility
	 **/

	// 0 == unknown, 1 == default (legacy), 2 == suite (SeaMonkey), 3 == Firefox with related tabs
	_browserTypeCached: 0,
	get _browserType( )
	{
		if (this._browserTypeCached == 0)
		{
			const xai = Components.classes["@mozilla.org/xre/app-info;1"].
			            getService(Components.interfaces.nsIXULAppInfo);
			const vc =  Components.classes["@mozilla.org/xpcom/version-comparator;1"].
			            getService(Components.interfaces.nsIVersionComparator);

			if (xai.ID == "{ec8030f7-c20a-464f-9b0e-13a3a9e97384}" && vc.compare(xai.version, "3.6") >= 0)
				this._browserTypeCached = 3;
			else if (xai.ID == "{92650c4d-4b8e-4d2a-b7eb-24ecf4f6b63a}")
				this._browserTypeCached = 2;
			else
				this._browserTypeCached = 1;
		}

		return(this._browserTypeCached);
	},

	get _isSuite( ) { return(this._browserType == 2); },
	get _supportsNewTabLoad( ) { return(this._browserType == 3); },

	// Wrapper for loadOneTab/addTab
	_loadTab: function( aURI, aReferrerURI, aPostData, aLoadInBackground )
	{
		if (this._isSuite && !("loadOneTab" in gBrowser))
			gBrowser.addTab(aURI, aReferrerURI, null, !aLoadInBackground, 0);
		else if (this._supportsNewTabLoad)
			gBrowser.loadOneTab(aURI, {
				referrerURI: aReferrerURI,
				charset: null,
				postData: aPostData,
				inBackground: aLoadInBackground,
				allowThirdPartyFixup: false,
				relatedToCurrent: true
			});
		else
			gBrowser.loadOneTab(aURI, aReferrerURI, null, aPostData, aLoadInBackground, false);
	},

	// Wrapper for saveURL
	_saveURL: function( aURL, aReferrer, aSourceDocument )
	{
		// Unlike _loadTab, we need to do the scheme fixup manually; the "." is
		// omitted because example.org:80 is probably server:80, not scheme:80
		if (!/^[a-z][\da-z+\-]*:/i.test(aURL))
			aURL = aURL.replace(/^:*[\/\\\s]*/, "http://").replace(/^ht(tp:\/\/ftp\.)/i, "f$1");

		// If the protocol is not supported, let it fall through to a new tab
		if (!/^(?:https?|ftp):/i.test(aURL))
			return(false);

		if (this._isSuite)
			saveURL(aURL, null, null, false, aReferrer);
		else
			saveURL(aURL, null, null, false, true, aReferrer, aSourceDocument);

		return(true);
	},

	// Wrapper for saveImageURL
	_saveImage: function( aURL, aReferrer, aSourceDocument )
	{
		if (this._isSuite)
			saveImageURL(aURL, null, null, false, aReferrer);
		else
			saveImageURL(aURL, null, null, false, true, aReferrer, aSourceDocument);
	}
};

window.addEventListener("load", QuickDragListener, false);
window.addEventListener("unload", QuickDragListener, false);
