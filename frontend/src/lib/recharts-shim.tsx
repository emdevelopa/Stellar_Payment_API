import { createElement, type ReactNode } from "react";

type ChartProps = {
  children?: ReactNode;
  className?: string;
  [key: string]: unknown;
};

function passthrough(tag = "div") {
  return function ChartShim({ children, ...props }: ChartProps) {
    return createElement(tag, props, children);
  };
}

function inert() {
  return function ChartPrimitive() {
    return null;
  };
}

export const ResponsiveContainer = passthrough("div");
export const BarChart = passthrough("div");
export const LineChart = passthrough("div");
export const Bar = inert();
export const Line = inert();
export const CartesianGrid = inert();
export const Tooltip = inert();
export const XAxis = inert();
export const YAxis = inert();
