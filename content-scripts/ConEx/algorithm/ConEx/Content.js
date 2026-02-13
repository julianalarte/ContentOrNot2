/**
* The main process of the webExtension. 
*	Input: The body of the webpage loaded in the current tab.
*	Output: The body of the webpage loaded in the current tab. The DOM nodes corresponding to the main content marked as main content nodes.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/
ConEx.conex.Content = function(body)
{
	this.negativeTokens = new Array("cookie","error","gdpr","banner","carousel","consent","caption","swiper","dp-dfg-item","listing","header","menu","navigation","media","video");
	this.depth = 0;
	this.lastNode = null;
	this.paths = new Array();
	this.ancestorValues = new Array();
	this.commonAncestor = null;
	this.level = 0;
	this.totalWords = 0;
	this.longestText = 0;
	this.totalText = 0;
	this.numberOfTextNodes = 0;
	this.totalNodes = 0;
	this.aNodes = 0;
	
	this.processContent = function(body)
	{	
		let obtained = false;
		
		this.preprocess(body);
		this.removeNotAllowed(body);
		
		let ratios = new Array();
		
		this.totalWords = this.countAllTotalWords(body);
		
		this.totalNodes = this.countTotalNodes(body);
		
		this.aNodes = this.countANodes(body);

		this.removeUnwanted(body);

		this.traverseTextNodes(body);

		this.posNode(body, 0);		
		this.countWordsWithoutDist(body, ratios);
					
		let totalIterations = 0;
		let results = new Array();

		for(let i=0; i < ratios.length; i++){
			let texto = ratios[i][2];
			let cadena = ratios[i][3];
			let lastAdded = -1;
			let prof = ratios[i][0].depth;
			if (ratios[i][2] > ConEx.conex.Config.minTextLength){
				for(let j=0; j < ratios.length; j++){
					if (ratios[i][0].depth == ratios[j][0].depth && i != j && ratios[i][0].depth != undefined){
						if (ratios[i][1] == ratios[j][1] && ratios[j][2] > ConEx.conex.Config.minTextLength){
							texto += ratios[j][2];
							cadena += ratios[j][3];
							lastAdded = j;
							if (!this.paths.includes(ratios[j][0]))
								this.paths.push(ratios[j][0]);					
						}
					}
				}
			}
			if (lastAdded >= 0){
				let ancestor = this.getCommonAncestor(ratios[i][0], ratios[lastAdded][0]);
				let nodos = this.getDescendants(ancestor, ratios[lastAdded][0]);
				let distance= this.getPathLength(ancestor, ratios[lastAdded][0]);	
				if (this.commonAncestor != ancestor){
					totalIterations++;
					this.commonAncestor = ancestor;
					let resultado = new Array();
					resultado.push(totalIterations);
					resultado.push(ancestor);
					//console.log(this.commonAncestor.outerHTML);
					let numberLinks = this.countAWords(this.commonAncestor);
					let numberTotal = this.countTotalWords(this.commonAncestor);

					let ratio = (numberTotal-numberLinks)/numberTotal;						
					resultado.push(ratio);
					resultado.push(numberTotal);

					this.longestText = 0;
					this.totalText = 0;
					this.numberOfTextNodes = 0;
					this.checkLongestText(this.commonAncestor);
					this.checkMedianText(this.commonAncestor);
					resultado.push(this.longestText);
					resultado.push(this.totalText / this.numberOfTextNodes);
					resultado.push(this.countANodes(this.commonAncestor));
					
					//Evitar que se añadan a results nodos que ya están
					let enc = false;
					for (let i=0; i< results.length; i++){
						if (results[i][1] == resultado[1])
							enc = true;
					}

					if (enc == false)
						results.push(resultado);
					
					this.checkAncestorChildren(this.commonAncestor);
				}
			}
		}
		
		if (totalIterations > 0){
			let contador = 0;
			if (totalIterations == 1){
				if (results[0][2] < ConEx.conex.Config.textRatio)
					obtained = true;
				else{
					for(let i=0; i<this.ancestorValues.length; i++){
						if (this.ancestorValues[i] == 0)
							contador++;					
					}
					if (contador * 2 >= this.ancestorValues.length)
						obtained = true;
				}
			}
			else{
				let biggest = 0;
				let biggestValue = 0;					
				for(let i = 0; i < results.length; i++){	
					if (results[i][3] > biggestValue){
						biggest = i;
						biggestValue = results[i][3];
					}
				}
				if (results[biggest][2] < (ConEx.conex.Config.multipleTextRatio)){
					obtained = true;
				}
				else{
					let numRep = 0;
					for(let i = 0; i < results.length; i++){
						if (results[i][5] * ConEx.conex.Config.soloTextMultiplier < results[i][4] && results[i][6] < results[i][3] / ConEx.conex.Config.wordsPerLinkFactor && (results[i][2] < ConEx.conex.Config.textRatio && results[i][2] != 0))
							numRep++;
					}
					if (numRep >= results.length/2)
						obtained = true
				}
			}
		}
		else{
			for(let i=0; i < ratios.length; i++){
				if (this.totalWords < ratios[i][2] * ConEx.conex.Config.soloTextMultiplier)
					obtained = true;
			}
		}
		
		return { "hasContent": obtained, "mainContent": body };
	}
	
	this.checkAncestorChildren = function(node)
	{
		let children = node.childNodes;
		for (let i = 0; i < children.length; i++){  
			if(children[i].tagName != undefined){
				let numberLinks = this.countAWords(children[i]);
				let numberTotal = this.countTotalWords(children[i]);
				let ratio = (numberTotal-numberLinks)/numberTotal;	
				this.ancestorValues.push(ratio);
			}
		}
	}	
	
	this.posNode = function(node, depth)
	{
		if (node && node.childNodes.length > 0){
			let children = node.childNodes;
			depth++;
			node.pos = this.position;
			this.position++;
			for (let i = 0; i < children.length; i++){  
				if(children[i].nodeType != 3){
					children[i].depth = depth;
					if (this.depth < depth)
						this.depth = depth;
					this.posNode(children[i], depth);
				}
			}
		}
	}	

	this.removeNotAllowed = function(node)
	{
		if (node && node.nodeType == 1 && node.tagName != undefined){
			let classes = node.className + " ";
			let ids = node.id + " ";
			let nodo = document.createElement('div');
			nodo.textContent = "";	
			let found = false;
			
			for (let i=0; i < this.negativeTokens.length; i++){
				if ((classes.includes(this.negativeTokens[i])) || (ids.includes(this.negativeTokens[i]))){
					if (node){
						found = true;
					}
				}
			}
			if (found == true && node.parentNode)
				node.parentNode.replaceChild(nodo, node);
		}

		if (node && node.childNodes.length > 0){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				this.removeNotAllowed(node.childNodes[i]);
		}
	}	

	this.preprocess = function(node)
	{
		if (node.tagName == "SCRIPT" || node.tagName == "STYLE" || node.tagName == "IFRAME" || node.role == "dialog"){
			let nodo = document.createElement('div');
			nodo.textContent = "";
			node.parentNode.replaceChild(nodo, node)
		}
		if (node && node.childNodes.length > 0){
			var children = node.childNodes;
			for (var i = 0; i < children.length; i++){
				this.preprocess(children[i]);
			}
		}
	}
	
	this.checkLongestText = function(node)
	{
		if (node.nodeType == 3 && (!this.hasAncestor(node,"A"))){
			if (node.textContent.length > this.longestText)
				this.longestText = node.textContent.length;
		}
		if (node && node.childNodes.length > 0){
			var children = node.childNodes;
			for (var i = 0; i < children.length; i++){
				this.checkLongestText(children[i]);
			}
		}
	}
	
	this.checkMedianText = function(node)
	{
		if (node.nodeType == 3 && (!this.hasAncestor(node,"A"))){
			this.totalText += node.textContent.length;
			this.numberOfTextNodes++;			
		}
		if (node && node.childNodes.length > 0){
			var children = node.childNodes;
			for (var i = 0; i < children.length; i++){
				this.checkMedianText(children[i]);
			}
		}
	}	
	
	this.joinTextSiblings = function(node)
	{
		let texto = "";
		
		if (node){
			while (node.nextSibling){
				node = node.nextSibling;
				if (node && node.nodeType == 3){
					texto += node.textContent;
					node.textContent = "";
				}
			}
			
			while (node.previousSibling){
				node = node.previousSibling;
				if (node && node.nodeType == 3){
					texto += node.textContent;
					node.textContent = "";
				}
			}			
		}
		return texto;
	}
	
	this.traverseTextSiblings = function(node)
	{
		if (node){
			while (node.nextSibling){
				node = node.nextSibling;
				if (node && node.nodeType == 3)
					return true;
			}
			
			while (node.previousSibling){
				node = node.previousSibling;
				if (node && node.nodeType == 3)
					return true;
			}			
		}
		return false;
	}	
	
	this.traverseTextNodes = function(node)
	{
		if ((node) && (node.nodeType == 3 && (this.traverseTextSiblings(node)) && (node.textContent != ""))){
			let texto = this.joinTextSiblings(node);
			if (texto.replace(/[\n\r\t\s]+/g, "").length > ConEx.conex.Config.minTextLength){
				node.textContent = texto;
			}
		}
		
		if (node && node.childNodes.length > 0){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				this.traverseTextNodes(node.childNodes[i]);	
		}		
	}
	
	this.removeUnwanted = function(node)
	{
		if ((node) && (node.tagName == "FIELDSET" || node.tagName == "LABEL" || node.tagName == "BUTTON" || node.tagName == "INPUT" || node.tagName == "SELECT" || node.tagName == "NAV" || node.tagName == "FOOTER" || node.tagName == "HEADER" || node.tagName == "NOSCRIPT")){
			let nodo = document.createElement('div');
			nodo.textContent = "";
			node.parentNode.replaceChild(nodo, node);
		}
		
		if (node && node.childNodes.length > 0){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				this.removeUnwanted(node.childNodes[i]);	
		}		
	}
	
	this.countWordsWithoutDist = function(node, ratios)
	{
		let counter = 0;
		let cadena = "";
		
		if ((node && node.parentNode) && (node.parentNode.tagName != "BODY") && (node.nodeType == 3) && (!this.hasAncestor(node,"A"))){
				cadena = node.textContent.replace(/[\n\r\t\s]+/g, "");
				let rati = new Array();
				rati.push(node.parentNode);
				rati.push(this.getPath(node.parentNode));
				rati.push(cadena.length);
				rati.push(cadena);
				rati.push(node.parentNode.outerHTML);
				ratios.push(rati);
				cadena = "";
				node.explored = 1;		
		}

		if (node && node.childNodes.length > 0 && node.tagName != "A" && !node.explored){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				this.countWordsWithoutDist(node.childNodes[i], ratios);
		}
	}
	
	this.getPath = function(node)
	{
		let path = node.tagName + " ";
		if (node.tagName != "BODY"){
			node = node.parentNode;
			while (node && node.tagName != "BODY"){
				path += node.tagName + " ";
				node = node.parentNode;
			}
		}
		path += node.tagName;
		return path;
	}
	
	this.getCommonAncestor = function(node1, node2)
	{
		if (node1.tagName != "BODY" && node2.tagName != "BODY"){
			node1 = node1.parentNode;
			node2 = node2.parentNode;
			if (node1 == node2)
				return node1;
			while (node1 && node2 && node1.tagName != "BODY" && node2.tagName != "BODY"){
				node1 = node1.parentNode;
				node2 = node2.parentNode;
				if (node1 == node2)
					return node1;
			}
		}
		return null;
	}
	
	this.hasAncestor = function(node1, tag){
		if (node1.tagName == tag)
			return true;
			
		while (node1 && node1.tagName != "BODY"){
			node1 = node1.parentNode;
			if (node1.tagName == tag)
				return true;
		}
		return false;		
	}	
	
	this.getDescendants = function(node1, node2)
	{
		let descendants = 0;
		if (node2.tagName != "BODY"){
			node2 = node2.parentNode;
			
			if (node1 != node2){
				let children = node2.childNodes.length;
				for(let i=0; i < children; i++)
					if (node2.childNodes[i] && node2.childNodes[i].nodeType == 1)
						descendants++;			
			}
			
			while (node2 && node2.tagName != "BODY" && node1 != node2){
				node2 = node2.parentNode;
				
				if (node1 != node2){
					let children = node2.childNodes.length;
					for(let i=0; i < children; i++)
						if (node2.childNodes[i] && node2.childNodes[i].nodeType == 1)
							descendants++;			
				}
				
			}
		}
				if (node1 == node2){
					let children = node2.childNodes.length;
					for(let i=0; i < children; i++)
						if (node2.childNodes[i] && node2.childNodes[i].nodeType == 1)
							descendants++;			
				}		
		return descendants;
	}
	
	this.getPathLength = function(node1, node2)
	{
		let length = 0;
		if (node2.tagName != "BODY"){
			node2 = node2.parentNode;
			length++;
			while (node2 && node2.tagName != "BODY" && node1 != node2){
				node2 = node2.parentNode;
				length++;
			}
		}
		return length;
	}
	
	this.countAllTotalWords = function(node)
	{
		let counter = 0;
		let cadena = "";
		
		if ((node) && (node.nodeType == 3)){
			cadena = node.textContent.replace(/[\n\r\t\s]+/g, "");
			counter = counter + cadena.length;
			cadena = "";
		}

		if (node && node.childNodes.length > 0 && node.role != "dialog" && node.style.display != "none" && node.style.visibility != "hidden"){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				counter += this.countAllTotalWords(node.childNodes[i]);
		}

		return counter;
	}
	
	this.countAWords = function(node)
	{
		let counter = 0;
		let cadena = "";
		if ((node) && (node.nodeType == 3)){
			cadena = node.textContent.replace(/[\n\r\t\s]+/g, "");
			counter = counter + cadena.length;
			cadena = "";
		}

		if (node && node.childNodes.length > 0 && node.role != "dialog" && node.style.display != "none" && node.style.visibility != "hidden" && (node.tagName != "A")){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				counter += this.countAWords(node.childNodes[i]);
		}

		return counter;
	}
	
	this.countTotalWords = function(node)
	{
		let counter = 0;
		let cadena = "";
		
		if ((node) && (node.nodeType == 3)){
			cadena = node.textContent.replace(/[\n\r\t\s]+/g, "");
			counter = counter + cadena.length;
			cadena = "";
		}

		if (node && node.childNodes.length > 0 && node.role != "dialog" && node.style.display != "none" && node.style.visibility != "hidden"){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				counter += this.countTotalWords(node.childNodes[i]);
		}

		return counter;
	}	
	
	this.countTotalNodes = function(node)
	{
		let counter = 0;
		let cadena = "";
		
		if (node)
			counter++;

		if (node && node.childNodes.length > 0){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				counter += this.countTotalNodes(node.childNodes[i]);
		}

		return counter;
	}	
	
	this.countANodes = function(node)
	{
		let counter = 0;
		let cadena = "";
		
		if (node && node.nodeType == 1)
			if (node.tagName == "A")
				counter++;

		if (node && node.childNodes.length > 0){
			let children = node.childNodes.length;
			for(let i=0; i < children; i++)
				counter += this.countANodes(node.childNodes[i]);
		}

		return counter;
	}	
	
	return this.processContent(body);
}