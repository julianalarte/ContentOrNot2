if (typeof browser == "undefined")
  var browser = chrome;

var _supportsPromises = false;
try {
  _supportsPromises = browser.runtime.getPlatformInfo() instanceof Promise;
}
catch (e)
{
}

browser.runtime.onMessage.addListener(function(request, sender, sendResponse) {
	ConEx.BrowserOverlay.execute();
});

ConEx.BrowserOverlay =
{
	pageLoad : function()
	{
		var documentDOMNode = window.document;

		ConEx.BrowserOverlay.createPage(documentDOMNode);

		var view = documentDOMNode.defaultView;
		view.addEventListener("unload", ConEx.BrowserOverlay.pageUnload, true);
	},

	pageUnload : function(event)
	{
		var documentDOMNode = event.originalTarget;

		ConEx.BrowserOverlay.removePage(documentDOMNode);
	},

	pages : new Array(),
	getPage : function(pageId)
	{
		return ConEx.BrowserOverlay.pages[0];
	},
	createPage : function(pageId)
	{
		var page = new ConEx.ContentExtractor(pageId);
		ConEx.BrowserOverlay.pages.push(page);
		return page;
	},
	removePage : function(pageId)
	{
		ConEx.BrowserOverlay.pages = new Array();
	},

	execute : function()
	{
		console.log('[execute] outerHTML snippet:', 
			document.body.innerHTML.substring(0, 3000));
		console.log('[execute] START — readyState='+document.readyState+
					' bodyChildren='+document.body?.children?.length+
					' totalNodes='+document.body?.querySelectorAll('*')?.length);
		ConEx.BrowserOverlay.pageLoad();
		var contentExtractor = null;
		
		var documentDOMNode = window.document;
		if (document.location.ancestorOrigins.length < 1){	//Does not belong to an iframe
			console.log(documentDOMNode.body.outerHTML);
			var contentExtractor = ConEx.BrowserOverlay.getPage(documentDOMNode);
		}
		
		if (contentExtractor == null)
			return;

		var contentExtracted = contentExtractor.contentExtracted;

		if (!contentExtracted) {
			ConEx.BrowserOverlay.showProcessingMessage(contentExtractor);
		}
		else {
			ConEx.BrowserOverlay.toggleView(contentExtractor);
		}
	},

	extraction : function(contentExtractor)
	{
		var contentExtracted = contentExtractor.contentExtracted;
		if (!contentExtracted)
			ConEx.BrowserOverlay.extractContent(contentExtractor);
		else
			ConEx.BrowserOverlay.toggleView(menuExtractor);
	},
	
	extractContent : function(contentExtractor)
	{
		var initialURL = window.location.href;
		if (initialURL.search("about:") == -1){
			contentExtractor.extractContent(ConEx.BrowserOverlay.contentExtracted.bind(null, contentExtractor));
		}
		else {
			alert("Not a webpage");
			return;
		}
	},

	contentExtracted : function(contentExtractor)
	{
		browser.runtime.sendMessage({content: "clear"});
		ConEx.BrowserOverlay.toggleView(contentExtractor);
	},

	showProcessingMessage : function(contentExtractor)
	{
		browser.runtime.sendMessage({content: "message"});
		ConEx.BrowserOverlay.waitDomStable(function() {
			ConEx.BrowserOverlay.extraction(contentExtractor);
		});
	},

	// Añade esta función nueva al objeto BrowserOverlay:
	waitDomStable : function(callback)
	{
		const quietMs  = 600;
		const maxWait  = 6000;
		const started  = Date.now();
		let   timer    = null;
		let   mutations = 0;

		const done = function() {
			observer.disconnect();
			clearTimeout(timer);
			console.log('[waitDomStable] DONE — mutations='+mutations+' elapsed='+(Date.now()-started)+'ms');
			callback();
		};

		const reset = function(list) {
			if (list) mutations += list.length;
			clearTimeout(timer);
			if (Date.now() - started >= maxWait) { 
				console.log('[waitDomStable] MAX WAIT reached');
				done(); return; 
			}
			timer = setTimeout(done, quietMs);
		};

		const observer = new MutationObserver(reset);
		observer.observe(document.body, { childList: true, subtree: true });
		console.log('[waitDomStable] START — body children='+document.body.children.length);
		reset();
	},

	toggleView : function(contentExtractor)
	{
		contentExtractor.toggleView(ConEx.BrowserOverlay.toggledView)
	},

	toggledView : function()
	{	
		browser.runtime.sendMessage({content: "endExtraction"});
	}
};
