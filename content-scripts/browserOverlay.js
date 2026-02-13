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
		console.log("Executing");
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

		setTimeout(function() {
			ConEx.BrowserOverlay.extraction(contentExtractor);
		}, 350);
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
