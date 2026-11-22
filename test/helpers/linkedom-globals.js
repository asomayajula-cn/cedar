import { DOMParser, HTMLElement, Element, Node, parseHTML } from "linkedom";

const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");

globalThis.document = document;
globalThis.HTMLElement = HTMLElement;
globalThis.Element = Element;
globalThis.Node = Node;
globalThis.DOMParser = DOMParser;