/**
 * Generate HATEOAS pagination links for API responses
 * @param {Object} req - Express request object
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {number} totalPages - Total number of pages
 * @returns {Object} Links object with next/previous URLs or empty object
 */
export function generatePaginationLinks(req, page, limit, totalPages) {
  const links = {};

  // Construct base URL from request
  const protocol = req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}${req.baseUrl}${req.path}`;

  // Add query parameters for pagination
  const createUrl = (pageNum) => {
    const url = new URL(baseUrl);
    // Copy existing query params
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'page') { // Don't copy page param, we'll set it
        url.searchParams.set(key, value);
      }
    }
    url.searchParams.set('page', pageNum.toString());
    url.searchParams.set('limit', limit.toString());
    return url.toString();
  };

  if (page < totalPages) {
    links.next = createUrl(page + 1);
  }

  if (page > 1) {
    links.previous = createUrl(page - 1);
  }

  return Object.keys(links).length > 0 ? { links } : {};
}