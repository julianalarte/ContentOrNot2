/**
* It starts the content extraction when pressing the button. It also hides the non-content nodes when the main content is extracted.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/

ConEx.ContentExtractor = function(document)
{
	/******************************************************/
	/************************ Info ************************/
	/******************************************************/
	this.contentExtracted = false;
	this.showingContent = false;
	this.document = document;
	this.originalBody = this.document.body;
	this.contentBody = null;
	this.salida = "";

/**
* this.obtainAlgorithm() sets the algorithm, ConEx() in this case.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	
	this.obtainAlgorithm = function()
	{
		return new ConEx.conex.ConEx();			
	}

	/******************************************************/
	/****************** Extract Content ******************/
	/******************************************************/
	this.extractContentCallback = null;

/**
* this.extractContent() starts the content extraction calling this.extractWebContent().
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/
	this.extractContent = function(callback)
	{
		this.extractContentCallback = callback;

		if (this.contentExtracted)
		{
			this.extractContentCallback();
			return;
		}

		this.extractWebContent();
	}
	
/**
* this.extractContent() performs the content extraction by creating one instance of ConEx.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	
	this.extractWebContent = function()
	{
		let algorithm = this.obtainAlgorithm();
		algorithm.process(this.document, this.extractedWebContent.bind(this));
	}
	
/**
* this.extractContent(contentBody, contentNodes) hides the non-content when the main content is extracted. If configured, it also downloads a text file with the main content.
*	Input: The original body of the webpage (contentBody) and the modified body with the extracted content (contentNodes).
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/
this.extractedWebContent = function(contentBody, result) {
    try {
        this.contentExtracted = true;
        this.lastResult = result;
        this.contentBody = contentBody;  // ← esta línea faltaba

        const payload = {
            url:             window.location.href,
            result:          !!(result && result.hasContent),
            isIndex:         result?.isIndex          ?? null,
            repetitionScore: result?.repetitionScore  ?? null,
            tedDetails:      result?.tedDetails        ?? null
        };

        (typeof browser !== 'undefined' ? browser : chrome)
          .runtime
          .sendMessage({ type: 'PAGE_RESULT', payload });

    } catch (e) {
        (typeof browser !== 'undefined' ? browser : chrome)
          .runtime
          .sendMessage({ type: 'PAGE_ERROR', payload: {
              url: window.location.href,
              error: e?.message || String(e)
          }});
    } finally {
        this.extractContentCallback();
    }
}		
/*this.extractedWebContent = function(contentBody, result)
 {
    try {
        // Guarda estado y evita relanzar:
        this.contentExtracted = true;
        this.lastResult = result;

        // Envía el dictamen al background:
        const payload = {
            url: window.location.href,
            result: !!(result && result.hasContent)
        };
        (typeof browser !== 'undefined' ? browser : chrome)
          .runtime
          .sendMessage({ type: 'PAGE_RESULT', payload });
    } catch (e) {
        (typeof browser !== 'undefined' ? browser : chrome)
          .runtime
          .sendMessage({ type: 'PAGE_ERROR', payload: { url: window.location.href, error: e?.message || String(e) }});
    } finally {
        // Mantén tu flujo actual (si hubiese UI) y devuelve control
        this.extractContentCallback();
    }
 }*/

	/******************************************************/
	/******************** Toogle view *********************/
	/******************************************************/
	this.toggleViewCallback = null;

/**
* this.toggleView(callback) checks if the content has been extracted to toggle the view.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	
	this.toggleView = function(callback)
	{
		this.toggleViewCallback = callback;

		if (!this.contentExtracted)
		{
			this.toggleViewCallback();
			return;
		}

		this.toggleTheView();
	}

/**
* this.toggleTheView() toggles the view.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/		
	this.toggleTheView = function()
	{
		if (!this.showingContent){
			this.document.body = this.contentBody;
		}
		else
			this.document.body = this.originalBody;
		this.finishToggleView();
	}

/**
* this.finishToggleView() finishes the toggle view procedure.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/
	this.finishToggleView = function()
	{
		this.showingContent = this.document.body == this.contentBody;
		this.toggleViewCallback();
	}

/**
* this.posHide(node) calls the this.hideNode(node) function to hide the nodes that do not belong to the main content.
*	Input: The body of the webpage (node) with the marked content.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/		
	this.posHide = function(node)
	{
		if ((node.final != 1) && (this.hasFinalNodeDesc(node) < 1)){
			this.hideNode(node);
		}
		if (node.final == 1){
			this.salida += node.textContent;
		}
		else{
			if (node && node.childNodes.length > 0){
				let children = node.childNodes;
				for (let i = 0; i < children.length; i++){
					this.posHide(children[i]);
				}
			}
		}
	}	
	
/**
* this.hasFinalNodeDesc(node) counts the number of final nodes between a node and its descendants.
*	Input: A DOM node (node).
*	Output: An integer representing the number of DOM nodes marked as final between a node and its descendants.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	
	this.hasFinalNodeDesc = function(node)
	{
		let counter = 0;
		if (node.final == 1){
			counter++;
		}else{
			if (node && node.childNodes.length > 0){
				let children = node.childNodes;
				for (let i = 0; i < children.length; i++){
					counter += this.hasFinalNodeDesc(children[i]);
				}
			}
		}
		return counter;
	}

/**
* this.hideNode(node) hides a node in the DOM tree.
*	Input: A DOM node (node).
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	
	this.hideNode = function(node)
	{
		node.isHidden = true;

		if (node.style)
		{
			node.style.visibility = "hidden";
			return;
		}

		let nodeName = node.nodeName.toLowerCase();
		if (nodeName == "#text")
			node.nodeValue = "";
	}

/**
* this.makeTextFile(text) creates the text file.
*	Input: A text string (text).
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	
	this.makeTextFile = function (text) {
		var data = new Blob([text], {type: 'text/plain'});

		if (this.textFile !== null) {
		  window.URL.revokeObjectURL(this.textFile);
		}

		this.textFile = URL.createObjectURL(data);
	}	
}
