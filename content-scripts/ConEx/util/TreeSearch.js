/**
* TreeSearch.js contains functions used to traverse the DOM tree. 
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	

ConEx.util.TreeSearch = function(root, avoid)
{
	this.root = root;
	this.current = root;
	this.avoid = avoid;

	this.numChildToVisit = 0;
	this.bifurcation = new Array();

	this.reset = function reset()
	{
		this.current = this.root;
		this.numChildToVisit = 0;
		this.bifurcation = new Array();
	}

	this.avoided = function avoided(node)
	{
		for (var avoidIndex in this.avoid)
			if (this.avoid[avoidIndex] === node)
				return true;
		return false;
	}

	this.avoidNode = function avoidNode(node)
	{
		if (this.avoided(node))
			return;
		this.avoid.push(node);

		var found = false;
		if (this.current){
			var parent = this.current;
			while (!found && parent != this.root)
			{
				if (parent == node)
					found = true;
				parent = parent.parentNode;
			}
		}

		if (found)
			while (this.current != node)
			{
				this.current = this.current.parentNode;
				this.numChildToVisit = this.bifurcation[this.bifurcation.length - 1];
				ConEx.misc.Misc.arrayRemoveElement(this.bifurcation, this.bifurcation.length - 1);
			}
	}

	this.nextPreOrder = function nextPreOrder()
	{
		if (this.current == null)
			return null;

		var returnNode = null;
		do
		{
			var avoided = this.avoided(this.current);
			var numChildren = avoided ? 0 : this.current.childNodes.length;
			if (numChildren == 0 || this.numChildToVisit == numChildren)
			{
				if (numChildren == 0 && !avoided)
					returnNode = this.current;

				if (this.current == this.root)
				{
					this.current = null;
					break;
				}
				else
				{
					this.current = this.current.parentNode;
					this.numChildToVisit = this.bifurcation[this.bifurcation.length - 1];
					ConEx.misc.Misc.arrayRemoveElement(this.bifurcation, this.bifurcation.length - 1);
				}
			}
			else
			{
				if (this.numChildToVisit == 0)
					returnNode = this.current;

				this.current = this.current.childNodes[this.numChildToVisit];
				this.bifurcation.push(this.numChildToVisit + 1);
				this.numChildToVisit = 0;
			}
		}
		while (returnNode == null);

		return returnNode;
	}
	this.nextPostOrder = function nextPostOrder()
	{
		if (this.current == null)
			return null;

		var returnNode = null;
		do
		{
			var avoided = this.avoided(this.current);
			var numChildren = avoided ? 0 : this.current.childNodes.length;
			if (numChildren == 0 || this.numChildToVisit == numChildren)
			{
				if (!avoided)
					returnNode = this.current;

				if (this.current == this.root)
				{
					this.current = null;
					break;
				}
				else
				{
					this.current = this.current.parentNode;
					this.numChildToVisit = this.bifurcation[this.bifurcation.length - 1];
					ConEx.misc.Misc.arrayRemoveElement(this.bifurcation, this.bifurcation.length - 1);
				}
			}
			else
			{
				this.current = this.current.childNodes[this.numChildToVisit];
				this.bifurcation.push(this.numChildToVisit + 1);
				this.numChildToVisit = 0;
			}
		}
		while (returnNode == null);

		return returnNode;
	}
}