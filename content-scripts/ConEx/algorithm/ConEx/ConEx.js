/**
* It creates an instance of Content and returns the extracted main content.
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/

ConEx.conex.ConEx = function()
{
	this.body = null;
	this.document = null;
	this.processCallback = null;

	this.process = function(document, callback)
	{
		this.document = document;
		this.processCallback = callback;
		let body = document.body.cloneNode(true);
		const result = new ConEx.conex.Content(body);
		this.processCallback(body, result);
	}
}