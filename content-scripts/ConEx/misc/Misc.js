/**
* Misc.js contains miscellaneous functions used by the WebExtension. 
*
* @authors Josep Silva and Julián Alarte
* @version 1.0 07/07/2024
* @since 1.0
*/	

ConEx.misc.Misc =
{
	stringStartsWith : function(str, prefix)
	{
		var strLength = str.length;
		var preLength = prefix.length;

		if (strLength < preLength)
			return false;
		return str.substr(0, preLength) == prefix;
	},
	stringEndsWith : function(str, suffix)
	{
		var strLength = str.length;
		var sufLength = suffix.length;

		if (strLength < sufLength)
			return false;
		return str.substr(strLength - sufLength, sufLength) == suffix;
	},

	arrayRemoveElement : function(array, indexToRemove)
	{
		array.splice(indexToRemove, 1);
	},
	arrayAddElement : function(array, indexToAdd, element)
	{
		array.splice(indexToAdd, 0, element);
	},
	arrayIndex : function(array, element)
	{
		for (var arrayIndex in array)
			if (array[arrayIndex] == element)
				return arrayIndex;
		return -1;
	},
	arrayIndexSimilar : function(array, element)
	{
		for (var arrayIndex in array)
			if (array[arrayIndex].similar(element))
				return arrayIndex;
		return -1;
	},
	arrayContains : function(array, element)
	{
		return ConEx.misc.Misc.arrayIndex(array, element) != -1;
	},
	arrayContainsSimilar : function(array, element)
	{
		return ConEx.misc.Misc.arrayIndexSimilar(array, element) != -1;
	},
	arrayAppend : function(array, elements)
	{
		for (var elementIndex in elements)
			array.push(elements[elementIndex]);
	},
	arrayClone : function(array)
	{
		return array.slice(0);
	},

	numberRound : function(number, decimals)
	{
		var factor = Math.pow(10, decimals);

		return Math.round(number * factor) / factor;
	},
	randomInteger : function(min, max)
	{
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}
};