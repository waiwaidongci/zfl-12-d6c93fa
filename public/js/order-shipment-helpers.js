var OrderShipmentHelpers = (function () {
  function getCustomerName(item) {
    return (item.customerInfo && item.customerInfo.name) || item.customerName || "未知客户";
  }

  function filterOrders(orders, filters) {
    var f = filters || {};
    var result = orders;
    if (f.batchId) result = result.filter(function (o) { return o.batchId === f.batchId; });
    if (f.status) result = result.filter(function (o) { return o.status === f.status; });
    if (f.deliveryStart) result = result.filter(function (o) { return o.deliveryDate && o.deliveryDate >= f.deliveryStart; });
    if (f.deliveryEnd) result = result.filter(function (o) { return o.deliveryDate && o.deliveryDate <= f.deliveryEnd; });
    return result;
  }

  function filterShipments(shipments, filters) {
    var f = filters || {};
    var result = shipments;
    if (f.batchId) result = result.filter(function (s) { return s.batchId === f.batchId; });
    if (f.orderId) result = result.filter(function (s) { return s.orderId === f.orderId; });
    return result;
  }

  function getOrderFilterValues() {
    return {
      batchId: document.getElementById("orderBatchFilter") ? document.getElementById("orderBatchFilter").value : "",
      status: document.getElementById("orderStatusFilter") ? document.getElementById("orderStatusFilter").value : "",
      deliveryStart: document.getElementById("orderDeliveryStart") ? document.getElementById("orderDeliveryStart").value : "",
      deliveryEnd: document.getElementById("orderDeliveryEnd") ? document.getElementById("orderDeliveryEnd").value : "",
    };
  }

  function getShipmentFilterValues() {
    return {
      batchId: document.getElementById("shipmentBatchFilter") ? document.getElementById("shipmentBatchFilter").value : "",
      orderId: document.getElementById("shipmentStatusFilter") ? document.getElementById("shipmentStatusFilter").value : "",
    };
  }

  function calcOrderCounts(filteredOrders) {
    var pending = 0, partial = 0, completed = 0, cancelled = 0, approaching = 0, overdue = 0;
    var totalQty = 0, totalAmount = 0;
    for (var i = 0; i < filteredOrders.length; i++) {
      var o = filteredOrders[i];
      switch (o.status) {
        case "pending": pending++; break;
        case "partial": partial++; break;
        case "completed": completed++; break;
        case "cancelled": cancelled++; break;
      }
      if (o.status !== "cancelled" && o.status !== "completed") {
        if (o.isApproaching) approaching++;
        if (o.isOverdue) overdue++;
      }
      if (o.status !== "cancelled") {
        totalQty += Number(o.orderQuantity || 0);
        totalAmount += Number(o.totalAmount || 0);
      }
    }
    return {
      total: filteredOrders.length,
      pending: pending,
      partial: partial,
      completed: completed,
      cancelled: cancelled,
      approaching: approaching,
      overdue: overdue,
      totalOrderQuantity: totalQty,
      totalOrderAmount: totalAmount,
    };
  }

  function getValidOrdersForShipment(orders) {
    return orders.filter(function (o) {
      return o.status !== "cancelled" && o.remainingQuantity > 0;
    });
  }

  function renderBatchStockInfoHtml(availableRes) {
    return '<div class="row"><span class="label">估算数量</span><span>' + availableRes.estimatedCount.toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">旧模式销售</span><span>' + availableRes.oldSalesQuantity.toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">已发货</span><span>' + availableRes.shippedQuantity.toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">订单占用</span><span style="color:#c77700;">' + (availableRes.reservedQuantity || 0).toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">当前可售</span><strong style="color:#2e7d57;">' + availableRes.availableQuantity.toLocaleString() + ' 尾</strong></div>';
  }

  function renderDeliveryBadgeHtml(order) {
    if (order.isOverdue) {
      return '<span class="order-delivery-badge order-delivery-overdue">逾期 ' + Math.abs(order.daysRemaining) + ' 天</span>';
    }
    if (order.isApproaching) {
      return '<span class="order-delivery-badge order-delivery-approaching">还剩 ' + order.daysRemaining + ' 天</span>';
    }
    return "";
  }

  function renderDeliveryDateText(order) {
    var dateStr = order.deliveryDate || "-";
    if (order.daysRemaining !== null) {
      dateStr += " (" + (order.isOverdue ? "逾期" + Math.abs(order.daysRemaining) + "天" : "还剩" + order.daysRemaining + "天") + ")";
    }
    return dateStr;
  }

  function renderDeliveryDateClass(order) {
    if (order.isOverdue) return "order-delivery-overdue-text";
    if (order.isApproaching) return "order-delivery-approaching-text";
    return "";
  }

  function renderStatsHtml(stats) {
    return stats.map(function (pair) {
      return '<div class="stat"><span>' + pair[0] + '</span><strong>' + pair[1] + '</strong></div>';
    }).join("");
  }

  function renderOrderRemainingRow(remainingQty) {
    var cls = remainingQty > 0 ? "" : "meta";
    return '<div class="row"><span class="label">订单剩余</span><span class="' + cls + '">' + remainingQty.toLocaleString() + ' 尾</span></div>';
  }

  function renderOrderStockDetailRows(availableRes) {
    return '<div class="row"><span class="label">批次估算</span><span>' + availableRes.estimatedCount.toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">旧模式销售</span><span>' + availableRes.oldSalesQuantity.toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">已发货</span><span>' + availableRes.shippedQuantity.toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">订单占用</span><span style="color:#c77700;">' + (availableRes.reservedQuantity || 0).toLocaleString() + ' 尾</span></div>' +
      '<div class="row"><span class="label">批次可售</span><strong style="color:#2e7d57;">' + availableRes.availableQuantity.toLocaleString() + ' 尾</strong></div>';
  }

  return {
    getCustomerName: getCustomerName,
    filterOrders: filterOrders,
    filterShipments: filterShipments,
    getOrderFilterValues: getOrderFilterValues,
    getShipmentFilterValues: getShipmentFilterValues,
    calcOrderCounts: calcOrderCounts,
    getValidOrdersForShipment: getValidOrdersForShipment,
    renderBatchStockInfoHtml: renderBatchStockInfoHtml,
    renderDeliveryBadgeHtml: renderDeliveryBadgeHtml,
    renderDeliveryDateText: renderDeliveryDateText,
    renderDeliveryDateClass: renderDeliveryDateClass,
    renderStatsHtml: renderStatsHtml,
    renderOrderRemainingRow: renderOrderRemainingRow,
    renderOrderStockDetailRows: renderOrderStockDetailRows,
  };
})();
